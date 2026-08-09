"""Unified clarify checkpoint context (route + atomic parse follow-ups)."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ClarifyKind = Literal["route_orchestration", "atomic_parse", "img2img_confirm"]

_VALID_KINDS = frozenset({"atomic_parse", "route_orchestration", "img2img_confirm"})


class ClarifyContext(TypedDict, total=False):
    kind: ClarifyKind
    original_utterance: str
    clarify_question: str
    mentioned_keys: list[str]
    sidebar_attachment_ref_keys: list[str]
    clarify_kind: str


def _infer_kind(ctx: dict[str, Any]) -> ClarifyKind | None:
    raw = ctx.get("kind")
    if isinstance(raw, str) and raw in _VALID_KINDS:
        return raw  # type: ignore[return-value]
    legacy = str(ctx.get("clarify_kind") or "")
    if legacy in ("img2img_confirm", "sidebar_img2img"):
        return "img2img_confirm"
    if legacy:
        return "atomic_parse"
    return None


def pending_clarify(state: dict[str, Any]) -> ClarifyContext | None:
    ctx = state.get("clarify_context")
    if not isinstance(ctx, dict):
        return None
    original = str(ctx.get("original_utterance") or "").strip()
    if not original:
        return None
    kind = ctx.get("kind")
    if isinstance(kind, str) and kind not in _VALID_KINDS:
        return None
    out: ClarifyContext = dict(ctx)  # type: ignore[arg-type]
    inferred = _infer_kind(ctx)
    if inferred and "kind" not in out:
        out["kind"] = inferred
    return out


def pending_atomic_clarify(state: dict[str, Any]) -> ClarifyContext | None:
    return pending_clarify(state)
