"""Colloquial media-create / vision-qa utterance features (no hint-table growth)."""

from __future__ import annotations

import re

# Narrow: 生 + (一|个|张|个) … 图/图片/海报 — not 生活/生意/产生
_SHENG_CREATE = re.compile(
    r"生\s*(?:一\s*)?(?:个|张|幅)?\s*.{0,24}?(?:图片|图|海报|主图)"
)
_VISION_QA = re.compile(
    r"(?:这(?:个|张)?图片是什么|这是什么图|看看这张图|描述一下(?:这张)?图|"
    r"图里(?:有什么|是什么)|识别一下(?:这张)?图)"
)
_MEDIA_OBJECT = re.compile(r"(?:图片|海报|主图|照片|图)")


def normalize_colloquial_create_verbs(text: str) -> str:
    """Map oral 「生…图」→「生成…图」 for downstream suggest checks. Narrow patterns only."""
    t = text or ""
    if not t.strip():
        return t

    def _repl(m: re.Match[str]) -> str:
        chunk = m.group(0)
        # only first 生 → 生成 when pattern matched
        return "生成" + chunk[1:]

    return _SHENG_CREATE.sub(_repl, t, count=1)


def utterance_has_media_object(text: str) -> bool:
    return bool(_MEDIA_OBJECT.search(text or ""))


def suspected_media_create(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if suspected_vision_qa(t):
        return False
    if _SHENG_CREATE.search(t):
        return True
    # soft: 弄/整/来 + 图 class without 营销短语（keep minimal）
    if re.search(r"(?:弄|整|来)\s*(?:一\s*)?(?:张|个).{0,12}?(?:图|图片)", t):
        return True
    return False


def suspected_vision_qa(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return bool(_VISION_QA.search(t))
