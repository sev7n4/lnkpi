"""P4: Atomic Studio Intent — routing and modality classification."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import re

import yaml

from app.graph.intent import (
    CONFIRM_GEN_HINTS,
    modify_intent,
    single_node_gen_intent,
)
from app.graph.atomic_intent_ir import (
    derive_studio_prompt,
    intent_suggests_atomic_create,
    is_prompt_expand_intent,
    is_source_backed_media_generation,
    resolve_atomic_intent,
    resolve_output_modality,
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
    "分镜脚本",
    "脚本",
    "广告词",
    "文案",
    "口播稿",
))

PROMPT_EXPLICIT_KEYWORDS = tuple(_TAXONOMY.get("prompt_explicit_keywords") or (
    "prompt扩写",
    "提示词模式",
    "多模式扩写",
    "扩写prompt",
))

VIDEO_KEYWORDS = ("视频", "短片", "短视频", "15s", "15秒", "30s", "30秒")
_VIDEO_DURATION_RE = re.compile(r"(\d+)\s*(?:秒|s)", re.IGNORECASE)
AUDIO_KEYWORDS = ("配音", "旁白", "音频", "语音")
# Avoid bare 「图」— it matches campaign phrases like 「确认出图」.
IMAGE_KEYWORDS = ("海报", "banner", "视觉", "主图", "白底", "场景图", "产品图", "人物图", "风图")

TURNAROUND_IMAGE_PATTERN = re.compile(
    r"三视图|四视图|多视图|turnaround|角色设定|模特定妆|正侧背|模特图|"
    r"q版|q萌|chibi|二头身|洛丽塔|lolita|婚纱|战术|军事|牛仔|皮克斯|绘本|水彩",
    re.IGNORECASE,
)

TURNAROUND_PIPELINE = "turnaround_image"
TURNAROUND_ASPECT_RATIO = "2:1"

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
    "重复上一次操作",
    "重复上次",
    "重复上一步",
    "再来一遍",
    "再做一次",
    "重复上一操作",
))

# Full-campaign phrases — atomic keyword substrings (e.g. 「图」in「出图」) must not hijack.
CAMPAIGN_OVERRIDE_PHRASES = (
    "营销方案",
    "拆画布",
    "全链路",
    "campaign",
)

CAMPAIGN_COMPLEXITY_PHRASES = (
    "详情页方案",
    "详情页营销",
    "详情页构图",
    "详情页的构图",
    "构图方案",
    "视觉方案",
    "14节点",
    "14个节点",
    "整套分镜",
    "全套分镜",
    "分镜脚本方案",
)

OrchestrationComplexity = Literal["atomic", "campaign", "clarify"]

_VAGUE_ORCHESTRATION = frozenset({
    "帮我生成",
    "生成一下",
    "做一个",
    "来一张",
    "帮我做一张",
})

_CN_ORCH_COUNT = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
    "十一": 11,
    "十二": 12,
}


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
    "重复上一次操作",
    "重复上一操作",
    "重复上次",
    "重复上一步",
    "重新生成一张",
    "重新生成",
    "再生成一张",
    "再生成一次",
    "再生成一遍",
    "再跑一次",
    "再来一次",
    "再来一遍",
    "再做一次",
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


def _parse_orch_count(token: str) -> int | None:
    token = (token or "").strip()
    if not token:
        return None
    if token.isdigit():
        return int(token)
    if token in _CN_ORCH_COUNT:
        return _CN_ORCH_COUNT[token]
    if len(token) == 2 and token[0] == "十" and token[1] in _CN_ORCH_COUNT:
        return 10 + _CN_ORCH_COUNT[token[1]]
    return None


def _storyboard_shot_count(text: str) -> int | None:
    t = (text or "").strip()
    for pat in (
        r"([一二三四五六七八九十两\d]+)\s*个分镜",
        r"([一二三四五六七八九十两\d]+)\s*个镜头",
        r"([一二三四五六七八九十两\d]+)\s*张分镜",
    ):
        m = re.search(pat, t)
        if m:
            return _parse_orch_count(m.group(1))
    return None


def is_turnaround_image_intent(text: str) -> bool:
    """True when user wants multi-view character sheet as image (not prompt-only)."""
    t = (text or "").strip()
    if not t or is_prompt_expand_intent(t):
        return False
    return bool(TURNAROUND_IMAGE_PATTERN.search(t))


def turnaround_pipeline_user_note() -> str:
    """Light UX copy when auto-switching aspect for turnaround pipeline.
    Keep in sync with packages/shared/src/promptContent.ts TURNAROUND_PIPELINE_USER_NOTE
    """
    return (
        "已按角色设定图模版扩写并出图；"
        "在原有三视图（正/侧/背）基础上增加近景特写，共四格横排；"
        f"使用 {TURNAROUND_ASPECT_RATIO} 画幅（非账户默认比例）。"
    )


_BATCH_IMAGE_COUNT = re.compile(
    r"(?:生成|做|来)\s*([一二三四五六七八九十两\d]+)\s*张|"
    r"([一二三四五六七八九十两\d]+)\s*张(?:图|图片)",
)


def utterance_suggests_atomic_create(text: str) -> bool:
    """True when user wants a single-shot create-and-generate flow (shared IR + taxonomy)."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    if _matches_regenerate_hints(text):
        return False
    if _is_campaign_override(text):
        return False
    if is_turnaround_image_intent(text):
        return True
    if is_source_backed_media_generation(text):
        return True
    if is_prompt_expand_intent(text):
        return True
    if any(h in text for h in CONFIRM_GEN_HINTS) and not is_source_backed_media_generation(text):
        return False
    batch_m = _BATCH_IMAGE_COUNT.search(text or "")
    if batch_m:
        token = batch_m.group(1) or batch_m.group(2) or ""
        count = _parse_orch_count(token)
        if count is not None and count >= 2:
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
    if re.search(r"(?:出图|出一张图|生成图)", text or ""):
        return True
    return False


def atomic_create_intent(text: str) -> bool:
    """Deprecated routing helper — prefer intent_suggests_atomic_create in L0 path."""
    return utterance_suggests_atomic_create(text)


def regenerate_phrase_intent(text: str) -> bool:
    """True when utterance looks like regenerate/variant retry phrasing."""
    return _matches_regenerate_hints(text)


def atomic_regenerate_intent(text: str) -> bool:
    """True when user wants to re-run gen on existing atomic_node_id."""
    t = (text or "").strip()
    if not t:
        return False
    if _is_campaign_override(t):
        return False
    return should_regenerate_same_node(t)


def orchestration_complexity_intent(text: str) -> OrchestrationComplexity:
    """Phase 4: route high-complexity requests toward Campaign vs atomic."""
    from app.graph.planning_guard import detect_action, has_planning_image_conflict, is_planning_intent

    t = (text or "").strip()
    if not t:
        return "clarify"
    if has_planning_image_conflict(t):
        return "campaign"
    if "详情页" in t and is_planning_intent(t):
        if detect_action(t) != "write":
            return "campaign"
    if any(p in t for p in CAMPAIGN_COMPLEXITY_PHRASES) or _is_campaign_override(t):
        return "campaign"
    shots = _storyboard_shot_count(t)
    if shots is not None and shots >= 4:
        return "campaign"
    if "分镜" in t and any(x in t for x in ("12", "十二", "整套", "全套")):
        return "campaign"
    if t in _VAGUE_ORCHESTRATION:
        return "clarify"
    from app.graph.atomic_parse_util import parse_atomic_multi_items

    if parse_atomic_multi_items(t):
        return "atomic"
    if detect_action(t) == "write":
        return "atomic"
    if atomic_create_intent(t):
        return "atomic"
    return "clarify"


def resolve_intake_route(
    text: str,
    *,
    focus_node_id: str | None,
) -> Literal["single_node", "atomic_create", "chat"]:
    """Intake routing — campaign/orchestration requires explicit skill in route_decide."""
    if (
        focus_node_id
        and single_node_gen_intent(text)
        and not modify_intent(text)
    ):
        return "single_node"
    from app.graph.planning_guard import detect_action

    if detect_action(text) == "write":
        return "atomic_create"
    intent = resolve_atomic_intent(text, mentioned_keys=None)
    if intent_suggests_atomic_create(intent):
        return "atomic_create"
    return "chat"


def parse_atomic_target_type(
    text: str,
    *,
    mentioned_keys: list[str] | None = None,
) -> AtomicTargetType:
    """Classify output modality via structured Intent IR."""
    return resolve_output_modality(text, mentioned_keys=mentioned_keys)  # type: ignore[return-value]


def confirm_gate_for_type(target_type: AtomicTargetType) -> bool:
    types = (_TAXONOMY.get("target_types") or {})
    entry = types.get(target_type) or {}
    if "confirm_gate" in entry:
        return bool(entry["confirm_gate"])
    return target_type in ("video", "audio")


def infer_video_duration(text: str) -> int | None:
    match = _VIDEO_DURATION_RE.search(text or "")
    if not match:
        return None
    try:
        duration = int(match.group(1))
    except ValueError:
        return None
    return max(4, min(15, duration))


def build_atomic_spec(
    text: str,
    *,
    mentioned_keys: list[str] | None = None,
) -> dict[str, Any]:
    """Build atomic_spec from utterance + optional sidebar refs."""
    intent = resolve_atomic_intent(text, mentioned_keys=mentioned_keys)
    target_type = intent.output_modality
    utterance = intent.utterance
    studio_prompt = derive_studio_prompt(intent)
    title = utterance[:24] + ("…" if len(utterance) > 24 else "")
    spec: dict[str, Any] = {
        "target_type": target_type,
        "prompt": studio_prompt,
        "title": title or target_type,
        "confirm_gate": confirm_gate_for_type(target_type),
    }
    if is_turnaround_image_intent(utterance):
        spec["pipeline"] = TURNAROUND_PIPELINE
        spec["imageAspect"] = TURNAROUND_ASPECT_RATIO
        spec["resolutionBump"] = True
    if target_type == "video":
        duration = infer_video_duration(utterance)
        if duration is not None:
            spec["videoSettings"] = {"duration": duration}
    return spec


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
