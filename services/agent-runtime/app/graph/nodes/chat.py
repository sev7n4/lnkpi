"""Casual chat path when no marketing Skill is selected."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

_SYSTEM = (
    "你是 lnkpi 无限画布助手。用简洁中文回答用户。"
    "平台支持在画布上生成图片/视频等媒体；不得否认平台的图片生成能力，"
    "也不要引导用户使用第三方作图工具。"
    "当前是闲聊通道、尚未进入创作流程：不要声称「正在生成」「马上生成」「已开始出图」；"
    "若用户像要出图，请引导他们说「帮我生成一张…图」，或说明要解读侧栏图片；"
    "若用户要做电商详情页/主图营销方案，也可提示他们说明品类与渠道。"
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
            "你好。可以直接说「帮我生成一张…图」，或说明要解读侧栏图片；"
            "若要做电商详情页/主图营销方案，也可说明品类与渠道。"
        )
        return {
            "phase": "done",
            "skill_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=reply)],
        }

    return chat
