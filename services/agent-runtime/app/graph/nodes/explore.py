"""Explore canvas path — bind_tools for read / light-write / lifecycle only."""

from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from app.graph.canvas_commands import extract_canvas_commands
from app.tools.definitions import build_explore_tools

MAX_EXPLORE_TOOL_ROUNDS = 3

_EXPLORE_SYSTEM = (
    "你是 lnkpi 画布探索助手。用简洁中文回答。"
    "可通过工具读取画布节点、查询生成状态、取消任务或处理平台回退。"
    "不要调用 run_*_generation；用户要出图/生成视频时，提示其直接描述创作需求。"
    "\n\n当前画布摘要：\n{summary}"
)


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


def make_explore_node(*, llm: Any, nest: Any) -> Callable:
    async def explore(state: dict) -> dict:
        tools = build_explore_tools(nest)
        tools_by_name = {t.name: t for t in tools}
        llm_bound = llm.bind_tools(tools)

        try:
            summary = await nest.get_canvas_summary()
        except Exception:
            summary = {"error": "无法拉取画布摘要"}

        user_text = _latest_user_text(state.get("messages") or []) or "看看画布状态"
        convo: list[Any] = [
            SystemMessage(content=_EXPLORE_SYSTEM.format(summary=_serialize_tool_result(summary))),
            HumanMessage(content=user_text),
        ]

        final_reply = ""
        canvas_commands: list[dict[str, Any]] = []
        for _ in range(MAX_EXPLORE_TOOL_ROUNDS):
            ai = await llm_bound.ainvoke(convo)
            tool_calls = getattr(ai, "tool_calls", None) or []
            if not tool_calls:
                final_reply = str(getattr(ai, "content", "") or "").strip()
                break

            convo.append(ai)
            for tc in tool_calls:
                name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                tool_call_id = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", "")
                tool = tools_by_name.get(name)
                if tool is None:
                    result: Any = {"error": f"unknown tool: {name}"}
                else:
                    try:
                        result = await tool.ainvoke(args or {})
                    except Exception as exc:
                        result = {"error": str(exc)}
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
