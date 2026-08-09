"""P1: unified clarify_gate — route + atomic parse share one checkpoint subgraph (RU-7)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.clarify_context import ClarifyContext, ClarifyKind

_DEFAULT_ROUTE_QUESTION = (
    "请确认是要「单张图生图原子出图」，还是「完整多节点编排（需选用 Skill）」。"
)
_DEFAULT_ATOMIC_QUESTION = (
    "请补充要生成的内容类型和主题，例如：「帮我生成一张蓝牙耳机主图」。"
)

_THINKING_BY_KIND: dict[ClarifyKind, str] = {
    "route_orchestration": "待确认：单张出图还是完整编排",
    "atomic_parse": "待确认：创作类型与主题",
    "img2img_confirm": "待确认：多图融合换装细节",
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


def _resolve_kind(state: dict[str, Any]) -> ClarifyKind:
    existing = state.get("clarify_context")
    if isinstance(existing, dict):
        raw_kind = existing.get("kind")
        if raw_kind in ("route_orchestration", "atomic_parse", "img2img_confirm"):
            return raw_kind  # type: ignore[return-value]
    if state.get("route_clarify"):
        return "route_orchestration"
    return "atomic_parse"


def _mentioned_keys(state: dict[str, Any]) -> list[str]:
    route_ctx = state.get("route_context") or {}
    return list(
        state.get("sidebar_mentioned_keys")
        or route_ctx.get("mentioned_keys")
        or []
    )


def _original_utterance(state: dict[str, Any]) -> str:
    existing = state.get("clarify_context")
    if isinstance(existing, dict):
        original = str(existing.get("original_utterance") or "").strip()
        if original:
            return original
    route_ctx = state.get("route_context") or {}
    return str(route_ctx.get("utterance") or "").strip()


def _build_clarify_context(state: dict[str, Any], kind: ClarifyKind) -> ClarifyContext:
    question = str(state.get("clarify_question") or "").strip()
    original = _original_utterance(state)
    mentioned = _mentioned_keys(state)
    existing = state.get("clarify_context")
    if isinstance(existing, dict) and existing.get("original_utterance"):
        ctx: ClarifyContext = {
            "kind": kind,
            "original_utterance": str(existing.get("original_utterance") or original),
            "clarify_question": str(existing.get("clarify_question") or question),
            "mentioned_keys": list(existing.get("mentioned_keys") or mentioned),
        }
        if existing.get("clarify_kind"):
            ctx["clarify_kind"] = str(existing.get("clarify_kind"))
        if existing.get("sidebar_attachment_ref_keys"):
            ctx["sidebar_attachment_ref_keys"] = list(existing.get("sidebar_attachment_ref_keys") or [])
        return ctx
    return ClarifyContext(
        kind=kind,
        original_utterance=original,
        clarify_question=question,
        mentioned_keys=mentioned,
    )


def _default_question(kind: ClarifyKind) -> str:
    if kind == "route_orchestration":
        return _DEFAULT_ROUTE_QUESTION
    return _DEFAULT_ATOMIC_QUESTION


def make_clarify_gate_node() -> Callable:
    async def clarify_gate(state: dict) -> dict:
        kind = _resolve_kind(state)
        ctx = _build_clarify_context(state, kind)
        question = str(ctx.get("clarify_question") or state.get("clarify_question") or "").strip()
        if not question:
            question = _default_question(kind)
            ctx["clarify_question"] = question

        mentioned = list(ctx.get("mentioned_keys") or [])
        message = question
        if kind == "route_orchestration":
            message = question + _ref_ack_suffix(mentioned)

        thinking = str(state.get("thinking_summary") or "").strip() or _THINKING_BY_KIND[kind]
        flow_mode = "clarify_route" if kind == "route_orchestration" else "atomic_create"

        return {
            "phase": "clarify",
            "flow_mode": flow_mode,
            "route_clarify": kind == "route_orchestration",
            "clarify_context": ctx,
            "clarify_question": question,
            "thinking_summary": thinking,
            "messages": [AIMessage(content=message)],
        }

    return clarify_gate
