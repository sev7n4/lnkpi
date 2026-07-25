from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

Decision = Literal["none", "confirm", "revise"]

_NONE_TIP = "请确认主文案后回复「写入主文案」，或说明如何修改。"

_CONFIRM_HINTS = (
    "写入主文案",
    "确认写入",
    "可以写入",
    "用这个",
    "就这个",
    "写入",
)
_REVISE_HINTS = (
    "改成",
    "修改",
    "调整",
    "换",
    "不要",
    "重新",
    "revise",
    "改一下",
    "更偏",
    "要修改",
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def classify_copy_decision(text: str) -> Decision:
    lowered = text.strip().lower()
    if not lowered:
        return "none"
    if any(h in lowered for h in _REVISE_HINTS):
        return "revise"
    if any(h in lowered for h in _CONFIRM_HINTS):
        return "confirm"
    return "none"


def make_await_copy_confirm_node() -> Callable:
    async def await_copy_confirm(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        decision = classify_copy_decision(text)
        if decision == "none":
            return {
                "user_decision": "none",
                "awaiting_user": True,
                "phase": "await_copy_confirm",
                "copy_revise_only": False,
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "revise":
            return {
                "user_decision": "revise",
                "awaiting_user": True,
                "phase": "await_copy_confirm",
                "copy_revise_only": True,
            }
        return {
            "user_decision": "confirm",
            "awaiting_user": False,
            "phase": "await_copy_confirm",
            "copy_revise_only": False,
        }

    return await_copy_confirm
