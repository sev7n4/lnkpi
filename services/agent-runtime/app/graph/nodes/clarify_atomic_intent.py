"""Phase 2: clarify when atomic parse confidence is low."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_clarify_atomic_intent_node() -> Callable:
    async def clarify_atomic_intent(state: dict) -> dict:
        question = str(state.get("clarify_question") or "").strip()
        if not question:
            question = "请补充要生成的内容类型和主题，例如：「帮我生成一张蓝牙耳机主图」。"
        return {
            "phase": "done",
            "flow_mode": "atomic_create",
            "messages": [AIMessage(content=question)],
        }

    return clarify_atomic_intent
