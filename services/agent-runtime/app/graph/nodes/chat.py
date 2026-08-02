"""Casual chat path when no marketing Skill is selected."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

_SYSTEM = (
    "你是 lnkpi 无限画布助手。用简洁中文回答用户。"
    "当前未进入「企业营销方案」工作流，不要擅自创建画布方案或承诺自动出图。"
    "若用户想做电商详情页/主图营销方案并拆画布出图，提示他们直接说："
    "「帮我做一套…天猫详情页营销方案」。"
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_chat_node(*, llm: Any) -> Callable:
    async def chat(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or []) or "你好"
        ai = await llm.ainvoke(
            [
                SystemMessage(content=_SYSTEM),
                HumanMessage(content=text),
            ]
        )
        reply = str(getattr(ai, "content", ai) or "").strip() or (
            "你好。需要做电商详情页/主图营销方案并拆画布出图时，直接说明品类与渠道即可。"
        )
        return {
            "phase": "done",
            "skill_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=reply)],
        }

    return chat
