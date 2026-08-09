"""Explore canvas path — bind_tools for read / light-write / lifecycle only."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.errors import AgentToolError, from_exception
from app.graph.canvas_commands import extract_canvas_commands
from app.graph.explore_dispatch import (
    MANDATORY_INTENTS,
    classify_explore_intent,
    run_mandatory_explore,
    select_explore_tool_names,
)
from app.tools.definitions import EXPLORE_WRITE_TOOLS, build_explore_tools
from app.metrics import record_explore_dispatch

MAX_EXPLORE_TOOL_ROUNDS = 4

_UI_COMMAND_TOOLS = frozenset({
    "focus_node",
    "focus_nodes",
    "undo",
    "redo",
    "open_image_editor",
    "introduce_nodes_to_agent",
})

_ASSET_READ_TOOLS = frozenset({"list_user_assets", "list_public_assets"})

_LIFECYCLE_TOOLS = frozenset({
    "cancel_generation",
    "cancel_platform_fallback",
    "confirm_platform_fallback",
})

_EXPLORE_SYSTEM = (
    "你是 lnkpi 画布探索助手。用简洁中文回答。\n"
    "规则：\n"
    "1. 必须通过工具完成读写操作，禁止假装已执行。\n"
    "2. UI 操作（focus_node/focus_nodes/undo/redo/open_image_editor/introduce_nodes_to_agent）"
    "必须调用对应工具，不要仅用文字回复。\n"
    "3. list_user_assets / list_public_assets 必须调用工具，不可拒答。\n"
    "4. lifecycle 工具（cancel_* / confirm_platform_fallback）必须传 node_id"
    "（从画布摘要解析节点 id，不要用标题字符串代替）。\n"
    "5. 不要调用 run_*_generation；用户要出图/生成视频时，提示其直接描述创作需求。\n"
    "\n当前画布摘要：\n{summary}"
)

_UI_NUDGE = (
    "请调用对应的 explore 工具完成 UI/侧栏操作（focus_node、focus_nodes、undo、redo、"
    "open_image_editor、introduce_nodes_to_agent），不要只用文字描述已执行。"
)

_ASSET_NUDGE = "请调用 list_user_assets 或 list_public_assets 查询资产库，不要拒答。"

_CANCEL_NUDGE = (
    "请调用 cancel_generation 或 cancel_platform_fallback，传入 node_id，不要让用户手动操作。"
)

_NODE_WRITE_CLARIFY = "未能更新节点，请提供节点 id（如 prompt-1）。"


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _serialize_tool_result(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception:
        return str(result)


def _needs_ui_nudge(user_text: str, called: set[str], canvas_commands: list[dict[str, Any]]) -> bool:
    if canvas_commands:
        return False
    t = user_text
    if any(k in t for k in ("定位", "视口", "撤销", "重做", "精修", "编辑器", "引入", "侧栏")):
        return not called.intersection(_UI_COMMAND_TOOLS)
    return False


def _needs_asset_nudge(user_text: str, called: set[str]) -> bool:
    if "资产" in user_text or "素材库" in user_text:
        return not called.intersection(_ASSET_READ_TOOLS)
    return False


def _needs_cancel_nudge(user_text: str, called: set[str]) -> bool:
    if "取消" in user_text and ("生成" in user_text or "任务" in user_text):
        return "cancel_generation" not in called
    return False


def _pick_nudge(user_text: str, called: set[str], canvas_commands: list[dict[str, Any]]) -> str | None:
    if _needs_ui_nudge(user_text, called, canvas_commands):
        return _UI_NUDGE
    if _needs_asset_nudge(user_text, called):
        return _ASSET_NUDGE
    if _needs_cancel_nudge(user_text, called):
        return _CANCEL_NUDGE
    return None


async def _direct_undo_redo(
    user_text: str,
    tools_by_name: dict[str, Any],
    called: set[str],
    canvas_commands: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Deterministic fallback when LLM skips zero-arg UI tools."""
    if canvas_commands:
        return canvas_commands
    out = list(canvas_commands)
    if "撤销" in user_text and ("画布" in user_text or "操作" in user_text) and "undo" not in called:
        result = await tools_by_name["undo"].ainvoke({})
        called.add("undo")
        for cmd in extract_canvas_commands(result):
            if cmd not in out:
                out.append(cmd)
    elif "重做" in user_text and ("画布" in user_text or "撤销" in user_text) and "redo" not in called:
        result = await tools_by_name["redo"].ainvoke({})
        called.add("redo")
        for cmd in extract_canvas_commands(result):
            if cmd not in out:
                out.append(cmd)
    return out


def _resolve_node_id_by_title(summary: Any, title_fragment: str) -> str | None:
    if not isinstance(summary, dict):
        return None
    nodes = summary.get("nodes") or summary.get("nodeSummaries") or []
    if not isinstance(nodes, list):
        return None
    frag = title_fragment.strip()
    if not frag:
        return None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_title = str(node.get("title") or node.get("label") or "")
        if frag in node_title or node_title in frag:
            nid = str(node.get("id") or node.get("nodeId") or "")
            if nid:
                return nid
    return None


async def _direct_focus_or_editor(
    user_text: str,
    summary: Any,
    tools_by_name: dict[str, Any],
    called: set[str],
    canvas_commands: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if canvas_commands:
        return canvas_commands
    out = list(canvas_commands)
    title_match = re.search(r"[「『\"]([^」』\"]+)[」』\"]", user_text)
    title = title_match.group(1) if title_match else ""
    node_id = _resolve_node_id_by_title(summary, title) if title else None

    if node_id and "精修" in user_text and "open_image_editor" not in called:
        result = await tools_by_name["open_image_editor"].ainvoke({"node_id": node_id})
        called.add("open_image_editor")
        for cmd in extract_canvas_commands(result):
            if cmd not in out:
                out.append(cmd)
    elif node_id and ("定位" in user_text or "视口" in user_text) and "focus_node" not in called:
        result = await tools_by_name["focus_node"].ainvoke({"node_id": node_id})
        called.add("focus_node")
        for cmd in extract_canvas_commands(result):
            if cmd not in out:
                out.append(cmd)
    elif node_id and ("引入" in user_text or "侧栏" in user_text) and "introduce_nodes_to_agent" not in called:
        result = await tools_by_name["introduce_nodes_to_agent"].ainvoke({"node_ids": [node_id]})
        called.add("introduce_nodes_to_agent")
        for cmd in extract_canvas_commands(result):
            if cmd not in out:
                out.append(cmd)
    return out


def make_explore_node(*, llm: Any, nest: Any) -> Callable:
    async def explore(state: dict) -> dict:
        all_tools = build_explore_tools(nest)
        tools_by_name = {t.name: t for t in all_tools}

        try:
            summary = await nest.get_canvas_summary()
        except Exception:
            summary = {"error": "无法拉取画布摘要"}

        user_text = _latest_user_text(state.get("messages") or []) or "看看画布状态"

        intent = classify_explore_intent(user_text, summary=summary if isinstance(summary, dict) else None)
        if intent in MANDATORY_INTENTS:
            record_explore_dispatch(intent, "mandatory")
            mandatory = await run_mandatory_explore(
                intent,
                user_text,
                summary=summary if isinstance(summary, dict) else {},
                tools_by_name=tools_by_name,
            )
            out: dict[str, Any] = {
                "phase": "done",
                "skill_id": None,
                "user_decision": "none",
                "messages": [AIMessage(content=mandatory.reply_text or "已完成操作。")],
                "explore_summary": summary if isinstance(summary, dict) else None,
            }
            if mandatory.canvas_commands:
                out["canvas_commands"] = mandatory.canvas_commands
            return out

        record_explore_dispatch(intent, "llm")
        tool_names = select_explore_tool_names(intent, user_text)
        bound_tools = [tools_by_name[n] for n in sorted(tool_names) if n in tools_by_name]
        llm_bound = llm.bind_tools(bound_tools)

        system_content = _EXPLORE_SYSTEM.format(summary=_serialize_tool_result(summary))
        if intent == "node_write":
            allowed = ", ".join(sorted(tool_names))
            system_content += f"\n6. 本轮只允许调用下列工具之一：{allowed}。"

        convo: list[Any] = [
            SystemMessage(content=system_content),
            HumanMessage(content=user_text),
        ]

        final_reply = ""
        canvas_commands: list[dict[str, Any]] = []
        called_tools: set[str] = set()
        nudged = False
        write_retry_done = False

        for _ in range(MAX_EXPLORE_TOOL_ROUNDS):
            ai = await llm_bound.ainvoke(convo)
            tool_calls = getattr(ai, "tool_calls", None) or []
            if not tool_calls:
                final_reply = str(getattr(ai, "content", "") or "").strip()
                if (
                    intent == "node_write"
                    and not called_tools.intersection(EXPLORE_WRITE_TOOLS)
                    and not write_retry_done
                ):
                    write_retry_done = True
                    tool_names = select_explore_tool_names("node_write", user_text)
                    bound_tools = [tools_by_name[n] for n in sorted(tool_names) if n in tools_by_name]
                    llm_bound = llm.bind_tools(bound_tools)
                    allowed = ", ".join(sorted(tool_names))
                    convo.append(ai)
                    convo.append(
                        SystemMessage(
                            content=f"必须调用下列写入工具之一完成操作：{allowed}。"
                        )
                    )
                    continue
                nudge = _pick_nudge(user_text, called_tools, canvas_commands)
                if nudge and not nudged:
                    convo.append(ai)
                    convo.append(HumanMessage(content=nudge))
                    nudged = True
                    continue
                break

            convo.append(ai)
            for tc in tool_calls:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                tool_call_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", "")
                tool = tools_by_name.get(name)
                called_tools.add(str(name))
                if tool is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                else:
                    try:
                        result = await tool.ainvoke(args or {})
                    except AgentToolError as exc:
                        err = exc.error
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                    except Exception as exc:
                        err = from_exception(str(name), exc)
                        result = {
                            "error": err["message"],
                            "error_type": err["error_type"],
                            "retry_hint": err.get("retry_hint"),
                        }
                for cmd in extract_canvas_commands(result):
                    if cmd not in canvas_commands:
                        canvas_commands.append(cmd)
                convo.append(
                    ToolMessage(
                        content=_serialize_tool_result(result),
                        tool_call_id=str(tool_call_id or name),
                    )
                )
        else:
            final_reply = str(getattr(convo[-1], "content", "") or "").strip()

        canvas_commands = await _direct_undo_redo(
            user_text, tools_by_name, called_tools, canvas_commands
        )
        canvas_commands = await _direct_focus_or_editor(
            user_text, summary, tools_by_name, called_tools, canvas_commands
        )

        if intent == "node_write" and not called_tools.intersection(EXPLORE_WRITE_TOOLS):
            final_reply = _NODE_WRITE_CLARIFY

        if not final_reply:
            final_reply = "已查询画布信息。如需继续操作，请说明具体节点或任务。"

        out: dict[str, Any] = {
            "phase": "done",
            "skill_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=final_reply)],
            "explore_summary": summary if isinstance(summary, dict) else None,
        }
        if canvas_commands:
            out["canvas_commands"] = canvas_commands
        return out

    return explore
