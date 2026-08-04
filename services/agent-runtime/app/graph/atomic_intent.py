"""P4: Atomic Studio Intent — routing and modality classification."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml

from app.graph.intent import (
    CONFIRM_GEN_HINTS,
    marketing_intent,
    modify_intent,
    single_node_gen_intent,
)

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
# Avoid bare 「图」— it matches campaign phrases like 「确认出图」.
IMAGE_KEYWORDS = ("海报", "banner", "视觉", "主图", "白底", "场景图", "产品图", "人物图", "风图")

ATOMIC_CONFIRM_KEYWORDS = tuple(_TAXONOMY.get("atomic_confirm_keywords") or (
    "确认生成",
    "开始生成",
    "确认",
))

ATOMIC_CANCEL_KEYWORDS = ("取消", "不要了", "算了", "放弃")

ATOMIC_REGENERATE_HINTS = tuple(_TAXONOMY.get("atomic_regenerate_hints") or (
    "再试一次",
    "再试",
    "重试",
    "重新生成",
    "再来一次",
    "再生成一次",
    "再跑一遍",
))

# Full-campaign phrases — atomic keyword substrings (e.g. 「图」in「出图」) must not hijack.
CAMPAIGN_OVERRIDE_PHRASES = (
    "营销方案",
    "拆画布",
    "全链路",
    "campaign",
)


def _is_campaign_override(text: str) -> bool:
    return any(p in text for p in CAMPAIGN_OVERRIDE_PHRASES)


def _matches_regenerate_hints(text: str) -> bool:
    """True when utterance is retry/regenerate, not a new create request."""
    t = (text or "").strip()
    if not t:
        return False
    lowered = t.lower()
    if any(h in lowered or h in t for h in ATOMIC_REGENERATE_HINTS):
        return True
    if "重新生成" in t:
        return True
    if any(p in t for p in ("再生成一次", "再生成一遍", "再跑一次", "再生成一张")):
        return True
    return lowered in ("retry", "again")


_REGENERATE_STRIP_PHRASES = (
    "重新生成一张",
    "重新生成",
    "再生成一张",
    "再生成一次",
    "再生成一遍",
    "再跑一次",
    "再来一次",
    "再试一次",
    "再试",
    "重试",
)


def detect_regenerate_adjust(text: str) -> str | None:
    """Extract prompt-adjustment tail from regenerate utterance (L1-04)."""
    t = (text or "").strip()
    if not t or not _matches_regenerate_hints(t):
        return None
    remainder = t
    for phrase in sorted(_REGENERATE_STRIP_PHRASES, key=len, reverse=True):
        remainder = remainder.replace(phrase, "")
    remainder = remainder.strip("，,、。；; \t")
    if len(remainder) >= 2:
        return remainder
    return None


def is_regenerate_new_variant(text: str) -> bool:
    """True when user wants another node (variant), not retry on the same node."""
    return _matches_regenerate_hints(text) and detect_regenerate_adjust(text) is not None


def should_regenerate_same_node(text: str) -> bool:
    """Same-node retry only when regenerate phrasing has no variant/adjust tail."""
    return _matches_regenerate_hints(text) and not is_regenerate_new_variant(text)


def apply_regenerate_adjust(
    spec: dict[str, Any],
    adjust: str | None,
    *,
    parse_context: str | None = None,
) -> dict[str, Any]:
    """Merge adjust phrase (and optional style context) into atomic_spec.prompt."""
    if not adjust:
        return dict(spec)
    out = dict(spec)
    base = str(out.get("prompt") or "").strip()
    adj = adjust.strip()
    if any(h in adj for h in ("同样风格", "刚才那个风格", "按刚才", "跟刚才一样")):
        from app.graph.atomic_parse_util import style_seed_from_context

        style_seed = style_seed_from_context(parse_context)
        if style_seed:
            merged = f"{style_seed}；{base}" if base else style_seed
            out["prompt"] = merged
            return out
    if adj in base:
        return out
    out["prompt"] = f"{base}；{adj}" if base else adj
    return out


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
    if _matches_regenerate_hints(text):
        return False
    if any(h in text for h in CONFIRM_GEN_HINTS):
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


def atomic_regenerate_intent(text: str) -> bool:
    """True when user wants to re-run gen on existing atomic_node_id."""
    t = (text or "").strip()
    if not t:
        return False
    if _is_campaign_override(t):
        return False
    return should_regenerate_same_node(t)


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
