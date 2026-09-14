"""Explore canvas path — mandatory dispatch + LLM for read/write/open_query."""

from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.errors import AgentToolError, from_exception
from app.graph.canvas_commands import extract_canvas_commands
from app.graph.explore_dispatch import (
    MANDATORY_INTENTS,
    classify_explore_intent,
    run_mandatory_explore,
)
from app.metrics import record_explore_dispatch
from app.tools.definitions import EXPLORE_WRITE_TOOLS, build_explore_tools
from app.tools.tool_plan import META_TOOL_NAME, build_tool_plan
from app.tools.tool_registry import DEFERRED_TOOL_NAMES
from app.tools.tool_search import make_tool_search_tool

MAX_EXPLORE_TOOL_ROUNDS = 4

_EXPLORE_SYSTEM = (
    "你是 lnkpi 画布探索助手。用简洁中文回答。\n"
    "规则：\n"
    "1. 必须通过工具完成读写操作，禁止假装已执行。\n"
    "2. 不要调用 run_*_generation；用户要出图/生成视频时，提示其直接描述创作需求。\n"
    "3. 若需要当前未绑定的能力，先调用 tool_search 加载 deferred 工具。\n"
    "\n当前画布摘要：\n{summary}"
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


def _bind_plan_tools(
    llm: Any,
    tools_by_name: dict[str, Any],
    loaded: list[str],
) -> tuple[Any, frozenset[str]]:
    plan = build_tool_plan(loaded=loaded)
    bound_tools = [tools_by_name[n] for n in plan.ordered_visible if n in tools_by_name]
    return llm.bind_tools(bound_tools), plan.visible_names


def make_explore_node(*, llm: Any, nest: Any) -> Callable:
    async def explore(state: dict) -> dict:
        all_tools = build_explore_tools(nest)
        tools_by_name = {t.name: t for t in all_tools}

        loaded: list[str] = [
            n for n in (state.get("tool_plan_loaded") or []) if n in DEFERRED_TOOL_NAMES
        ]

        def on_loaded(names: list[str]) -> None:
            for name in names:
                if name in DEFERRED_TOOL_NAMES and name not in loaded:
                    loaded.append(name)

        tools_by_name[META_TOOL_NAME] = make_tool_search_tool(on_loaded=on_loaded)

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
                "tool_plan_loaded": list(loaded),
            }
            if mandatory.canvas_commands:
                out["canvas_commands"] = mandatory.canvas_commands
            return out

        record_explore_dispatch(intent, "llm")
        llm_bound, _visible = _bind_plan_tools(llm, tools_by_name, loaded)

        system_content = _EXPLORE_SYSTEM.format(summary=_serialize_tool_result(summary))

        convo: list[Any] = [
            SystemMessage(content=system_content),
            HumanMessage(content=user_text),
        ]

        final_reply = ""
        canvas_commands: list[dict[str, Any]] = []
        called_tools: set[str] = set()
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
                    llm_bound, _visible = _bind_plan_tools(llm, tools_by_name, loaded)
                    convo.append(ai)
                    convo.append(
                        SystemMessage(
                            content=(
                                "必须调用写入类工具完成操作（如 set_node_prompt、"
                                "import_workflow、upload_media_to_canvas 等）。"
                            )
                        )
                    )
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
                # Same-turn rebind after successful tool_search load.
                if (
                    str(name) == META_TOOL_NAME
                    and isinstance(result, dict)
                    and result.get("loaded")
                ):
                    llm_bound, _visible = _bind_plan_tools(llm, tools_by_name, loaded)
        else:
            final_reply = str(getattr(convo[-1], "content", "") or "").strip()

        if intent == "node_write" and not called_tools.intersection(EXPLORE_WRITE_TOOLS):
            final_reply = _NODE_WRITE_CLARIFY

        if not final_reply:
            final_reply = "已查询画布信息。如需继续操作，请说明具体节点或任务。"

        out = {
            "phase": "done",
            "skill_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=final_reply)],
            "explore_summary": summary if isinstance(summary, dict) else None,
            "tool_plan_loaded": list(loaded),
        }
        if canvas_commands:
            out["canvas_commands"] = canvas_commands
        return out

    return explore
