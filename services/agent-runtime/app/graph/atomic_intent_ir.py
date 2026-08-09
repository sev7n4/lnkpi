"""Structured atomic intent IR — action × output modality × sources.

Single source of truth for routing utterances to Studio target types.
Replaces blanket substring rules (e.g. any 「提示词」→ prompt).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

AtomicAction = Literal["generate", "expand", "write", "plan", "unknown"]
AtomicOutputModality = Literal["image", "video", "text", "prompt", "audio"]

GENERATE_VERBS = (
    "生成",
    "做一张",
    "做一个",
    "来一张",
    "来一段",
    "出一张",
    "直接生成",
    "帮我生成",
    "帮我做一张",
    "帮我做一个",
)

VIDEO_OUTPUT_KEYWORDS = ("视频", "短片", "短视频", "15s", "15秒", "30s", "30秒")
IMAGE_OUTPUT_KEYWORDS = ("海报", "banner", "视觉", "主图", "白底", "场景图", "产品图", "人物图", "风图")
SOURCE_MARKERS = ("文案", "提示词", "文本", "脚本", "口播稿", "分镜脚本", "广告词")

PROMPT_EXPAND_EXPLICIT = (
    "prompt扩写",
    "提示词模式",
    "多模式扩写",
    "扩写prompt",
    "三视图提示词",
    "四视图提示词",
    "多视图提示词",
    "角色设定图提示词",
    "模特定妆图提示词",
)

_TEXT_DEFAULT_KEYWORDS = ("分镜脚本", "脚本", "广告词", "文案", "口播稿")
_AUDIO_KEYWORDS = ("配音", "旁白", "音频", "语音")

_SOURCE_BACKED_GEN_RE = re.compile(
    r"(?:基于|根据|参考|用).{0,16}(?:文案|提示词|文本|脚本|口播稿)"
    r".{0,16}(?:生成|做|来).{0,12}(?:视频|短片|短视频|图片|主图|海报|图)",
    re.IGNORECASE,
)

_IMAGE_GENERATE_RE = re.compile(
    r"(?:生成|做|来)\s*(?:一张|一个|一张)?\s*(?:图|图片|主图|海报|白底|场景图|产品图|人物图)",
    re.IGNORECASE,
)

_PROMPT_OBJECT_RE = re.compile(
    r"(?:分镜|三视图|四视图|多视图|角色设定|模特定妆|商业分镜).*提示词|提示词\s*$|的提示词",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class AtomicIntent:
    action: AtomicAction
    output_modality: AtomicOutputModality
    utterance: str
    source_markers: tuple[str, ...] = ()
    mentioned_keys: tuple[str, ...] = ()


def _normalize(text: str) -> str:
    return (text or "").replace(" ", "").lower()


def has_generate_verb(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if any(v in t for v in GENERATE_VERBS):
        return True
    if re.search(r"(?:生成|做|来|出)(?:一张|一个|一段|一条)", t):
        return True
    return False


def has_video_output(text: str) -> bool:
    t = (text or "").strip()
    lowered = t.lower()
    return any(k in t or k in lowered for k in VIDEO_OUTPUT_KEYWORDS)


def has_image_output(text: str) -> bool:
    t = (text or "").strip()
    lowered = t.lower()
    if _IMAGE_GENERATE_RE.search(t):
        return True
    return any(k in t or k in lowered for k in IMAGE_OUTPUT_KEYWORDS)


def has_source_marker(text: str) -> bool:
    t = (text or "").strip()
    return any(m in t for m in SOURCE_MARKERS)


def is_source_backed_media_generation(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if _SOURCE_BACKED_GEN_RE.search(t):
        return True
    if has_source_marker(t) and re.search(
        r"(?:生成|做)\s*(?:视频|短片|短视频|图片|主图|海报)",
        t,
    ):
        return True
    return False


def is_ref_media_generation(text: str, mentioned_keys: list[str] | None = None) -> bool:
    t = (text or "").strip()
    keys = mentioned_keys or []
    if keys and has_generate_verb(t) and (has_video_output(t) or has_image_output(t)):
        return True
    if re.search(r"@\w", t) and has_generate_verb(t) and (has_video_output(t) or has_image_output(t)):
        return True
    return False


def is_prompt_expand_intent(text: str) -> bool:
    """Expand/write prompt node — not media generation from a source."""
    t = (text or "").strip()
    if not t:
        return False
    if is_source_backed_media_generation(t):
        return False
    if is_ref_media_generation(t):
        return False
    n = _normalize(t)
    if any(_normalize(k) in n for k in PROMPT_EXPAND_EXPLICIT):
        return True
    if "扩写" in t and ("prompt" in n or "提示词" in t):
        return True
    if _PROMPT_OBJECT_RE.search(t):
        return True
    if "提示词模式" in t:
        return True
    return False


def has_modality_conflict_risk(text: str) -> bool:
    """Utterances where legacy substring rules mis-fire — require guard / no fast-path."""
    t = (text or "").strip()
    if not t:
        return False
    return is_source_backed_media_generation(t) or bool(re.search(r"@\w", t) and has_generate_verb(t))


def is_text_product_request(text: str) -> bool:
    """User wants a text artifact (口播稿/脚本/广告词), not media file generation."""
    t = (text or "").strip()
    if not t:
        return False
    if re.search(r"(?:口播稿|广告词|分镜脚本)(?:[，。！？\s]|$)", t):
        return True
    if re.search(r"(?:写|来一段|撰写|起草).*(?:口播稿|广告词|脚本)", t):
        return True
    if "分镜脚本" in t and "提示词" not in t and not is_source_backed_media_generation(t):
        return True
    return False


def resolve_output_modality(
    text: str,
    *,
    mentioned_keys: list[str] | None = None,
) -> AtomicOutputModality:
    t = (text or "").strip()
    keys = mentioned_keys or []

    if is_text_product_request(t):
        return "text"

    if is_source_backed_media_generation(t) or is_ref_media_generation(t, keys):
        if has_video_output(t):
            return "video"
        if has_image_output(t):
            return "image"

    if any(k in t for k in _AUDIO_KEYWORDS):
        return "audio"

    if is_prompt_expand_intent(t):
        return "prompt"

    if any(k in t for k in _TEXT_DEFAULT_KEYWORDS):
        if has_video_output(t) and has_generate_verb(t) and not is_text_product_request(t):
            return "video"
        if has_image_output(t) and has_generate_verb(t) and not is_text_product_request(t):
            return "image"
        return "text"

    if has_video_output(t):
        return "video"

    from app.graph.planning_guard import is_explicit_generation_intent, is_planning_intent

    if is_planning_intent(t) and not is_explicit_generation_intent(t):
        return "text"

    if has_image_output(t) or any(k in t.lower() for k in IMAGE_OUTPUT_KEYWORDS):
        return "image"

    return "image"


def resolve_atomic_action(text: str) -> AtomicAction:
    t = (text or "").strip()
    if not t:
        return "unknown"
    if is_source_backed_media_generation(t) or is_ref_media_generation(t):
        return "generate"
    if is_prompt_expand_intent(t):
        return "expand"
    from app.graph.planning_guard import detect_action

    return detect_action(t)  # type: ignore[return-value]


def resolve_atomic_intent(
    text: str,
    *,
    mentioned_keys: list[str] | None = None,
) -> AtomicIntent:
    t = (text or "").strip()
    keys = tuple(mentioned_keys or [])
    markers = tuple(m for m in SOURCE_MARKERS if m in t)
    action = resolve_atomic_action(t)
    output = resolve_output_modality(t, mentioned_keys=list(keys))
    if action == "expand" and output not in ("prompt",):
        output = "prompt"
    if action == "write" and output not in ("text",):
        output = "text"
    return AtomicIntent(
        action=action,
        output_modality=output,
        utterance=t,
        source_markers=markers,
        mentioned_keys=keys,
    )


def derive_studio_prompt(intent: AtomicIntent) -> str:
    """Short node prompt for Studio; sidebar/canvas refs carry source body."""
    t = intent.utterance
    if intent.output_modality == "video" and (
        intent.source_markers or intent.mentioned_keys or is_source_backed_media_generation(t)
    ):
        return "基于引用内容生成视频"
    if intent.output_modality == "image" and (
        intent.source_markers or intent.mentioned_keys or is_source_backed_media_generation(t)
    ):
        return "基于引用内容生成图片"
    return t


def expected_output_modality(
    text: str,
    *,
    mentioned_keys: list[str] | None = None,
) -> AtomicOutputModality | None:
    """When IR is confident about media output, return expected modality for guards."""
    t = (text or "").strip()
    if not has_modality_conflict_risk(t) and not (mentioned_keys or []):
        return None
    if is_source_backed_media_generation(t) or is_ref_media_generation(t, mentioned_keys):
        if has_video_output(t):
            return "video"
        if has_image_output(t):
            return "image"
    return None
