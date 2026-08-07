"""Helpers for atomic parse clarify follow-ups (img2img affirmatives)."""

from __future__ import annotations

from typing import Any

from app.graph.l0_action import TRANSFORM_VERBS, utterance_has_multi_image_refs

_AFFIRMATIVE_EXACT = frozenset(
    {"是的", "对", "好", "ok", "确认", "可以", "嗯", "行", "1", "要", "需要", "生成", "是", "对的"}
)


def pending_atomic_clarify(state: dict[str, Any]) -> dict[str, Any] | None:
    ctx = state.get("clarify_context")
    if isinstance(ctx, dict) and str(ctx.get("original_utterance") or "").strip():
        return ctx
    return None


def is_affirmative_clarify_reply(text: str) -> bool:
    raw = (text or "").strip()
    if not raw or len(raw) > 16:
        return False
    lowered = raw.lower()
    if lowered in _AFFIRMATIVE_EXACT:
        return True
    return any(k in raw for k in ("是的", "确认", "可以", "需要", "要生成"))


def is_img2img_utterance(utterance: str) -> bool:
    t = (utterance or "").strip()
    if not t:
        return False
    return utterance_has_multi_image_refs(t) and any(v in t for v in TRANSFORM_VERBS)
