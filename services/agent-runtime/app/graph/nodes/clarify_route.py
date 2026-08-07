"""Route-level clarify — orchestration vs atomic (not atomic parse clarify)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_clarify_route_node() -> Callable:
    async def clarify_route(state: dict) -> dict:
        question = str(state.get("clarify_question") or "").strip()
        if not question:
            question = (
                "请确认是要「单张图生图原子出图」，还是「完整多节点编排（需选用 Skill）」。"
            )
        return {
            "phase": "done",
            "flow_mode": "chat",
            "route_clarify": False,
            "messages": [AIMessage(content=question)],
        }

    return clarify_route
