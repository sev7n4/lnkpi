"""Phase 2: structured atomic parse result schema and validation."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from langchain_core.messages import AIMessage

from app.graph.atomic_intent import confirm_gate_for_type, _is_campaign_override
from app.graph.sidebar_attachments import assign_sidebar_ref_keys
from app.graph.sidebar_copy import format_atomic_multi_ack, format_atomic_parse_ack
from app.graph.planning_guard import has_planning_image_conflict, planning_clarify_question

CLARIFY_THRESHOLD = 0.70
RULE_FAST_PATH_THRESHOLD = 0.95
MAX_ATOMIC_MULTI_ITEMS = 5

VALID_TARGET_TYPES = frozenset({"image", "text", "video", "audio", "prompt"})


class AtomicParseItem(TypedDict, total=False):
    target_type: str
    title: str
    prompt: str
    confirm_gate: bool
    pipeline: str
    imageAspect: str
    resolutionBump: bool
    promptMode: str
    prompt_mode: str
    videoSettings: dict[str, Any]
    videoMode: str
    referenceImageUrl: str


def _clamp_video_duration(value: Any) -> int | None:
    try:
        duration = int(value)
    except (TypeError, ValueError):
        return None
    return max(4, min(15, duration))


def _normalize_video_settings(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    if raw.get("aspectRatio"):
        out["aspectRatio"] = str(raw["aspectRatio"])
    duration = _clamp_video_duration(raw.get("duration"))
    if duration is not None:
        out["duration"] = duration
    if raw.get("resolution"):
        out["resolution"] = str(raw["resolution"])
    if raw.get("crop"):
        out["crop"] = str(raw["crop"])
    if raw.get("generateAudio") is not None:
        out["generateAudio"] = bool(raw["generateAudio"])
    return out or None

class AtomicParseSuccess(TypedDict):
    kind: Literal["success"]
    structure: Literal["single", "multi"]
    items: list[AtomicParseItem]
    confidence: float
    reason: str


class AtomicParseClarify(TypedDict):
    kind: Literal["clarify"]
    confidence: float
    reason: str
    clarify_question: str


ParseOutcome = AtomicParseSuccess | AtomicParseClarify


def _normalize_item(raw: dict[str, Any]) -> AtomicParseItem | None:
    target = str(raw.get("target_type") or "").strip()
    if target not in VALID_TARGET_TYPES:
        return None
    prompt = str(raw.get("prompt") or "").strip()
    if not prompt:
        return None
    title = str(raw.get("title") or prompt[:24] or target).strip()
    confirm = raw.get("confirm_gate")
    if confirm is None:
        confirm = confirm_gate_for_type(target)  # type: ignore[arg-type]
    item: dict[str, Any] = {
        "target_type": target,
        "title": title,
        "prompt": prompt,
        "confirm_gate": bool(confirm),
    }
    if raw.get("pipeline"):
        item["pipeline"] = str(raw["pipeline"])
    if raw.get("imageAspect"):
        item["imageAspect"] = str(raw["imageAspect"])
    if raw.get("resolutionBump") is not None:
        item["resolutionBump"] = bool(raw["resolutionBump"])
    pm = raw.get("promptMode") or raw.get("prompt_mode")
    if pm:
        item["promptMode"] = str(pm)
    video_settings = _normalize_video_settings(raw.get("videoSettings"))
    if video_settings:
        item["videoSettings"] = video_settings
    if raw.get("videoMode"):
        item["videoMode"] = str(raw["videoMode"])
    if raw.get("referenceImageUrl"):
        item["referenceImageUrl"] = str(raw["referenceImageUrl"])
    return item  # type: ignore[return-value]


def _default_clarify_question(utterance: str) -> str:
    return (
        f"我还不太确定「{utterance[:24]}」具体要生成什么。"
        "请补充模态（图片/文案/视频/音频）和主题，例如：「帮我生成一张蓝牙耳机主图」。"
    )


def validate_parse_result(
    data: dict[str, Any] | None,
    *,
    utterance: str = "",
) -> ParseOutcome:
    """Validate LLM/rule JSON into success or clarify outcome."""
    if not isinstance(data, dict):
        return {
            "kind": "clarify",
            "confidence": 0.0,
            "reason": "invalid_payload",
            "clarify_question": _default_clarify_question(utterance),
        }

    if has_planning_image_conflict(utterance):
        return {
            "kind": "clarify",
            "confidence": 0.0,
            "reason": "planning_image_conflict",
            "clarify_question": planning_clarify_question(utterance),
        }

    if _is_campaign_override(utterance):
        return {
            "kind": "clarify",
            "confidence": 0.0,
            "reason": "campaign_override",
            "clarify_question": "这听起来像完整营销方案需求。请确认是要「全链路 Campaign 方案」，还是单张/单条原子创作？",
        }

    confidence_raw = data.get("confidence")
    try:
        confidence = float(confidence_raw)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    clarify_q = str(data.get("clarify_question") or "").strip()
    if confidence < CLARIFY_THRESHOLD or data.get("needs_clarify"):
        return {
            "kind": "clarify",
            "confidence": confidence,
            "reason": str(data.get("reason") or "low_confidence"),
            "clarify_question": clarify_q or _default_clarify_question(utterance),
        }

    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        single = _normalize_item(data)
        if single is not None:
            raw_items = [single]
        else:
            return {
                "kind": "clarify",
                "confidence": confidence,
                "reason": "empty_items",
                "clarify_question": clarify_q or _default_clarify_question(utterance),
            }

    items: list[AtomicParseItem] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        item = _normalize_item(raw)
        if item is not None:
            items.append(item)

    if not items:
        return {
            "kind": "clarify",
            "confidence": confidence,
            "reason": "invalid_items",
            "clarify_question": clarify_q or _default_clarify_question(utterance),
        }

    from app.graph.atomic_intent_ir import expected_output_modality

    expected = expected_output_modality(utterance)
    rewrite_reason = str(data.get("reason") or "validated")
    if expected:
        first_type = str(items[0].get("target_type") or "")
        if first_type != expected:
            from app.graph.atomic_intent import build_atomic_spec

            fixed = build_atomic_spec(utterance)
            fixed_item = _normalize_item(fixed)
            if fixed_item is not None:
                items[0] = fixed_item
                confidence = max(confidence, 0.92)
                rewrite_reason = "modality_ir_rewrite"

    if len(items) > MAX_ATOMIC_MULTI_ITEMS:
        return {
            "kind": "clarify",
            "confidence": min(confidence, 0.5),
            "reason": "multi_item_limit",
            "clarify_question": (
                f"原子创作一次最多支持 {MAX_ATOMIC_MULTI_ITEMS} 个同模态节点。"
                "如需更多资产或完整营销链路，请改用 Campaign 方案（例如：「帮我做一套详情页营销方案」）。"
            ),
        }

    structure_raw = str(data.get("structure") or "").strip()
    structure: Literal["single", "multi"] = "multi" if len(items) > 1 else "single"
    if structure_raw in ("single", "multi"):
        structure = structure_raw  # type: ignore[assignment]

    return {
        "kind": "success",
        "structure": structure,
        "items": items,
        "confidence": confidence,
        "reason": rewrite_reason,
    }


def outcome_from_rule_items(
    items: list[dict[str, Any]],
    *,
    confidence: float,
    reason: str = "rule_parse",
) -> ParseOutcome:
    payload = {
        "structure": "multi" if len(items) > 1 else "single",
        "items": items,
        "confidence": confidence,
        "reason": reason,
    }
    return validate_parse_result(payload, utterance=items[0].get("prompt", "") if items else "")


def parse_outcome_to_state(
    outcome: ParseOutcome,
    *,
    canvas_context: str | None = None,
    prior_spec: dict[str, Any] | None = None,
    sidebar_attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Map validated parse outcome to graph state patch."""
    if outcome["kind"] == "clarify":
        return {
            "phase": "clarify",
            "flow_mode": "atomic_create",
            "parse_confidence": outcome["confidence"],
            "clarify_question": outcome["clarify_question"],
        }

    items = outcome["items"]
    first = dict(items[0])
    if canvas_context:
        first["canvas_context"] = canvas_context
        for item in items:
            item.setdefault("canvas_context", canvas_context)
    for item in items:
        pm = item.get("prompt_mode") or item.get("promptMode")
        if pm and "promptMode" not in item:
            item["promptMode"] = pm

    ref_keys = assign_sidebar_ref_keys(sidebar_attachments) or None

    if len(items) == 1:
        spec = first
        msg = format_atomic_parse_ack(spec, prior_spec=prior_spec, ref_keys=ref_keys)
        return {
            "phase": "atomic_parse",
            "flow_mode": "atomic_create",
            "atomic_spec": spec,
            "atomic_items": None,
            "parse_confidence": outcome["confidence"],
            "messages": [AIMessage(content=msg)],
        }

    msg = format_atomic_multi_ack(items, prior_spec=prior_spec)
    return {
        "phase": "atomic_parse",
        "flow_mode": "atomic_create",
        "atomic_spec": first,
        "atomic_items": [dict(i) for i in items],
        "parse_confidence": outcome["confidence"],
        "messages": [AIMessage(content=msg)],
    }
