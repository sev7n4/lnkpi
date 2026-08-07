"""L0 action hints — preserve vs plan vs generate (platform routing)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.graph.planning_guard import ActionKind

PRESERVE_MARKERS = ("不变", "保持", "维持", "沿用")
TRANSFORM_VERBS = ("穿上", "换装", "替换", "融合", "上身", "换上", "换穿", "试穿", "佩戴", "搭配")
_REF_KEY_PATTERN = re.compile(r"@([ITVA]\d+)", re.IGNORECASE)


def has_preserve_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return any(m in t for m in PRESERVE_MARKERS)


def utterance_has_multi_image_refs(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    image_keys = {
        m.group(1).upper()
        for m in _REF_KEY_PATTERN.finditer(t)
        if m.group(1).upper().startswith("I")
    }
    return len(image_keys) >= 2


def detect_l0_action(text: str) -> "ActionKind":
    from app.graph.planning_guard import detect_action

    t = (text or "").strip()
    if not t:
        return "unknown"
    if has_preserve_intent(t):
        return "preserve"
    return detect_action(t)
