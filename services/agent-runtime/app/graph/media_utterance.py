"""Colloquial media-create / vision-qa utterance features (no hint-table growth)."""

from __future__ import annotations

import re

# 生 + 必需量词(个|张|幅) + 短修饰 + 图类 — 排除 生活/生意/先生这张图/产生了很多图表
_SHENG_CREATE = re.compile(
    r"生\s*(?:一\s*)?(?:个|张|幅)\s*[^。，,.!?？！]{0,10}?(?:图片|海报|主图|图(?![书层标表例]))"
)
# 软信号：弄/整/来 + 量词 + 图类，且图后不接 书/层/标/表/例（图书/图层/图标/图表/图例）
_SOFT_CREATE = re.compile(
    r"(?:弄|整|来)\s*(?:一\s*)?(?:张|个)\s*[^。，,.!?？！]{0,8}?(?:图片|图)(?![书层标表例])"
)
_VISION_QA = re.compile(
    r"(?:这(?:个|张)?图片是什么|这是什么图|看看这张图|描述一下(?:这张)?图|"
    r"图里(?:有什么|是什么)|识别一下(?:这张)?图)"
)
# 窄口径：指向侧栏媒体的疑问/指示句（调用方必须再叠加 has_sidebar_media）
_SIDEBAR_MEDIA_QUESTION = re.compile(
    r"(?:这|那)\s*(?:个|张|幅)?\s*(?:图片|图)?\s*(?:是什么|是啥|什么|啥)"
    r"|(?:看看|看一下|看下|描述|识别|解读|分析)\s*(?:一下)?\s*(?:这|那|它|图片|图)"
    r"|(?:什么|啥)\s*(?:图片|图)"
    r"|^(?:看看|看一下|看下)[。？?！!]?$"
)
_MEDIA_OBJECT = re.compile(r"(?:图片|海报|主图|照片|图)")


def normalize_colloquial_create_verbs(text: str) -> str:
    """Map oral 「生…图」→「生成…图」 for downstream suggest checks. Narrow patterns only.

    Idempotent for already-「生成」 text: 生成 never matches _SHENG_CREATE because
    the quantifier (个|张|幅) is required right after 生.
    """
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
    return bool(_SOFT_CREATE.search(t))


def suspected_vision_qa(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return bool(_VISION_QA.search(t))


def media_directed_question(text: str) -> bool:
    """Narrow 疑问/指示 signal aimed at attached media (gate with has_sidebar_media)."""
    t = (text or "").strip()
    if not t:
        return False
    if suspected_media_create(t):
        return False
    return bool(_VISION_QA.search(t) or _SIDEBAR_MEDIA_QUESTION.search(t))
