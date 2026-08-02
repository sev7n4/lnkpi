from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

from app.graph.intent import classify_copy_decision
from app.graph.limits import MAX_COPY_REVISE

Decision = Literal["none", "confirm", "revise"]

_NONE_TIP = "请确认主文案后回复「写入主文案」，或说明如何修改。"
_MAX_COPY_REVISE_TIP = (
    f"已达最大修订次数（{MAX_COPY_REVISE} 次），请确认当前文案（回复「写入主文案」），"
    "或说明放弃本轮。"
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_await_copy_confirm_node() -> Callable:
    async def await_copy_confirm(state: dict) -> dict:
        # W5: interrupt_before 替代 awaiting_user flag
        # 从 checkpoint 恢复时，state 已包含用户新消息
        text = _latest_user_text(state.get("messages") or [])
        decision = classify_copy_decision(text)
        if decision == "none":
            return {
                "user_decision": "none",
                "phase": "await_copy_confirm",
                "copy_revise_only": False,
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "revise":
            revise_count = int(state.get("copy_revise_count") or 0)
            if revise_count >= MAX_COPY_REVISE:
                return {
                    "user_decision": "none",
                    "phase": "await_copy_confirm",
                    "copy_revise_only": False,
                    "force_choice": "copy_max_revise",
                    "messages": [AIMessage(content=_MAX_COPY_REVISE_TIP)],
                }
            return {
                "user_decision": "revise",
                "phase": "await_copy_confirm",
                "copy_revise_only": True,
                "copy_revise_count": revise_count + 1,
            }
        return {
            "user_decision": "confirm",
            "phase": "await_copy_confirm",
            "copy_revise_only": False,
            "copy_revise_count": 0,
            "force_choice": None,
        }

    return await_copy_confirm
