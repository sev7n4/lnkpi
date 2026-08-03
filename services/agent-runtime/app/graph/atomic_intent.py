"""P4: Atomic Studio Intent — routing and modality classification."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml

from app.graph.intent import marketing_intent, modify_intent, single_node_gen_intent

_TAXONOMY_PATH = (
    Path(__file__).resolve().parents[2] / "skills" / "atomic-create" / "intent-taxonomy.yaml"
)


def _normalize(text: str) -> str:
    return (text or "").replace(" ", "").lower()


def _load_taxonomy() -> dict[str, Any]:
    if not _TAXONOMY_PATH.is_file():
        return {}
    return yaml.safe_load(_TAXONOMY_PATH.read_text(encoding="utf-8")) or {}


_TAXONOMY = _load_taxonomy()

AtomicTargetType = Literal["image", "text", "video", "audio", "prompt"]

ATOMIC_CREATE_HINTS = tuple(_TAXONOMY.get("atomic_create_hints") or (
    "帮我生成",
    "帮我做一张",
    "生成一个",
    "生成一张",
    "做一个",
    "来一张",
    "来一段",
    "写一段",
    "配一段",
))

TEXT_DEFAULT_KEYWORDS = tuple(_TAXONOMY.get("text_default_keywords") or (
    "分镜提示词",
    "分镜脚本",
    "脚本",
    "广告词",
    "文案",
    "分镜",
    "口播稿",
))

PROMPT_EXPLICIT_KEYWORDS = tuple(_TAXONOMY.get("prompt_explicit_keywords") or (
    "prompt扩写",
    "提示词模式",
    "多模式扩写",
    "扩写prompt",
))

VIDEO_KEYWORDS = ("视频", "短片", "短视频", "15s", "15秒", "30s", "30秒")
AUDIO_KEYWORDS = ("配音", "旁白", "音频", "语音")
IMAGE_KEYWORDS = ("图", "海报", "banner", "视觉", "主图")

ATOMIC_CONFIRM_KEYWORDS = tuple(_TAXONOMY.get("atomic_confirm_keywords") or (
    "确认生成",
    "开始生成",
    "确认",
))

ATOMIC_CANCEL_KEYWORDS = ("取消", "不要了", "算了", "放弃")

# Full-campaign phrases — atomic keyword substrings (e.g. 「图」in「出图」) must not hijack.
CAMPAIGN_OVERRIDE_PHRASES = (
    "营销方案",
    "拆画布",
    "全链路",
    "campaign",
)


def _is_campaign_override(text: str) -> bool:
    return any(p in text for p in CAMPAIGN_OVERRIDE_PHRASES)


def _has_prompt_explicit(text: str) -> bool:
    n = _normalize(text)
    if any(_normalize(k) in n for k in PROMPT_EXPLICIT_KEYWORDS):
        return True
    return "扩写" in text and ("prompt" in n or "提示词" in text)


def atomic_create_intent(text: str) -> bool:
    """True when user wants a single-shot create-and-generate flow."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    if _is_campaign_override(text):
        return False
    if _has_prompt_explicit(text):
        return True
    if any(h in lowered for h in ATOMIC_CREATE_HINTS):
        return True
    if any(h in text for h in TEXT_DEFAULT_KEYWORDS):
        return True
    if any(h in lowered for h in VIDEO_KEYWORDS):
        return True
    if any(h in text for h in AUDIO_KEYWORDS):
        return True
    if any(h in lowered for h in IMAGE_KEYWORDS):
        return True
    return False


def resolve_intake_route(
    text: str,
    *,
    focus_node_id: str | None,
) -> Literal["campaign", "single_node", "atomic_create", "chat"]:
    """Intake routing per ADR-003 priority."""
    if (
        focus_node_id
        and single_node_gen_intent(text)
        and not modify_intent(text)
    ):
        return "single_node"
    if atomic_create_intent(text):
        return "atomic_create"
    if marketing_intent(text):
        return "campaign"
    return "chat"


def parse_atomic_target_type(text: str) -> AtomicTargetType:
    """Classify modality from user utterance (D1: storyboard → text)."""
    t = (text or "").strip()
    lowered = t.lower()
    if _has_prompt_explicit(t):
        return "prompt"
    if any(k in t for k in AUDIO_KEYWORDS):
        return "audio"
    if any(k in t for k in TEXT_DEFAULT_KEYWORDS):
        return "text"
    if any(k in lowered for k in VIDEO_KEYWORDS):
        return "video"
    if any(k in lowered for k in IMAGE_KEYWORDS):
        return "image"
    return "image"


def confirm_gate_for_type(target_type: AtomicTargetType) -> bool:
    types = (_TAXONOMY.get("target_types") or {})
    entry = types.get(target_type) or {}
    if "confirm_gate" in entry:
        return bool(entry["confirm_gate"])
    return target_type in ("video", "audio")


def build_atomic_spec(text: str) -> dict[str, Any]:
    """Build atomic_spec from raw user utterance."""
    utterance = (text or "").strip()
    target_type = parse_atomic_target_type(utterance)
    title = utterance[:24] + ("…" if len(utterance) > 24 else "")
    return {
        "target_type": target_type,
        "prompt": utterance,
        "title": title or target_type,
        "confirm_gate": confirm_gate_for_type(target_type),
    }


AtomicConfirmDecision = Literal["none", "confirm", "cancel"]


def classify_atomic_confirm(text: str) -> AtomicConfirmDecision:
    """Classify user reply at await_atomic_confirm (D2)."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return "none"
    if any(k in lowered for k in ATOMIC_CANCEL_KEYWORDS):
        return "cancel"
    if any(k in lowered for k in ATOMIC_CONFIRM_KEYWORDS):
        return "confirm"
    if lowered in ("ok", "okay", "yes", "1", "y"):
        return "confirm"
    return "none"
