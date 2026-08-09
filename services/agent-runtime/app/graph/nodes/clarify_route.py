"""Route-level clarify — orchestration vs atomic (not atomic parse clarify)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def _snapshot_route_clarify_context(state: dict) -> dict[str, Any]:
    route_ctx = state.get("route_context") or {}
    utterance = str(route_ctx.get("utterance") or "").strip()
    mentioned = list(
        state.get("sidebar_mentioned_keys")
        or route_ctx.get("mentioned_keys")
        or []
    )
    return {
        "kind": "route_orchestration",
        "original_utterance": utterance,
        "clarify_question": str(state.get("clarify_question") or "").strip(),
        "mentioned_keys": mentioned,
    }


def _ref_ack_suffix(mentioned_keys: list[str]) -> str:
    text_keys = [k for k in mentioned_keys if str(k).upper().startswith("T")]
    if not text_keys:
        image_keys = [k for k in mentioned_keys if str(k).upper().startswith("I")]
        if image_keys:
            labels = ", ".join(f"@{k}" for k in image_keys[:3])
            return f"\n\n已看到引用 {labels}。"
        return ""
    labels = ", ".join(f"@{k}" for k in text_keys[:3])
    return f"\n\n已看到引用 {labels}。"


def make_clarify_route_node() -> Callable:
    async def clarify_route(state: dict) -> dict:
        question = str(state.get("clarify_question") or "").strip()
        if not question:
            question = (
                "请确认是要「单张图生图原子出图」，还是「完整多节点编排（需选用 Skill）」。"
            )
        ctx = _snapshot_route_clarify_context(state)
        mentioned = list(ctx.get("mentioned_keys") or [])
        message = question + _ref_ack_suffix(mentioned)
        return {
            "phase": "clarify",
            "flow_mode": "clarify_route",
            "route_clarify": True,
            "clarify_context": ctx,
            "messages": [AIMessage(content=message)],
        }

    return clarify_route
