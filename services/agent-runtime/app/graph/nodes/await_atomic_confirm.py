"""P4: HITL gate before video/audio generation (D2)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_intent import classify_atomic_confirm

_NONE_TIP = "视频/音频生成将消耗积分。回复「确认生成」开始，或「取消」放弃。"
_CANCEL_MSG = "已取消本次视频/音频生成。"


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _resolve_atomic_confirm_decision(state: dict, text: str) -> str:
    """Prefer chip-injected user_decision; fall back to text classifier."""
    injected = str(state.get("user_decision") or "").strip().lower()
    if injected == "confirm":
        return "confirm"
    if injected in ("revise", "replan"):
        return "cancel"
    return classify_atomic_confirm(text)


def make_await_atomic_confirm_node() -> Callable:
    async def await_atomic_confirm(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        decision = _resolve_atomic_confirm_decision(state, text)
        spec = state.get("atomic_spec") or {}
        target = str(spec.get("target_type") or "video")

        if decision == "none":
            return {
                "user_decision": "none",
                "phase": "await_atomic_confirm",
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "cancel":
            return {
                "user_decision": "revise",
                "phase": "done",
                "messages": [AIMessage(content=_CANCEL_MSG)],
            }
        return {
            "user_decision": "confirm",
            "phase": "await_atomic_confirm",
            "messages": [AIMessage(content=f"已确认，开始 {target} 生成…")],
        }

    return await_atomic_confirm
