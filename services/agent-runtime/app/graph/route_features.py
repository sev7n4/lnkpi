"""P1: structured RouteFeatures from RouteContext + AtomicIntent (RU-3, RU-6)."""

from __future__ import annotations

import re
from typing import TypedDict

from app.graph.atomic_intent import atomic_regenerate_intent, regenerate_phrase_intent
from app.graph.atomic_intent_ir import AtomicIntent, intent_suggests_atomic_create
from app.graph.explore_route import explore_explicit_intent
from app.graph.intent import single_node_gen_intent
from app.graph.l0_action import has_preserve_intent, utterance_has_multi_image_refs
from app.graph.planning_guard import has_planning_image_conflict
from app.graph.route_context import RouteContext

# Orchestration phrase table — no bare 「出图」 (RU-3 / design §9.8.2)
_ORCHESTRATION_PHRASES = (
    "详情页",
    "全链路",
    "营销方案",
    "分镜脚本方案",
    "详情页方案",
    "详情页营销",
    "详情页构图",
    "详情页的构图",
    "整套分镜",
    "全套分镜",
    "campaign",
    "拆画布",
    "14个节点",
    "14节点",
)


class RouteFeatures(TypedDict, total=False):
    has_text_ref: bool
    has_image_ref: bool
    has_multi_image_ref: bool
    explicit_skill: bool
    has_atomic_checkpoint: bool
    preserve_composition: bool
    orchestration_phrases: bool
    modality_conflict_risk: bool
    explore_blocked: bool


def _text_keys(keys: list[str]) -> list[str]:
    return [k for k in keys if str(k).upper().startswith("T")]


def _image_keys(keys: list[str]) -> list[str]:
    return [k for k in keys if str(k).upper().startswith("I")]


def _has_orchestration_phrases(utterance: str) -> bool:
    t = (utterance or "").strip()
    if not t:
        return False
    if "出图" in t and not any(p in t for p in _ORCHESTRATION_PHRASES if p != "出图"):
        # Single 「出图」/ ref-backed generate is not orchestration.
        if not any(p in t for p in ("详情页", "全链路", "营销方案", "分镜", "campaign", "拆画布", "节点")):
            return False
    return any(p in t for p in _ORCHESTRATION_PHRASES)


def _explore_blocked(utterance: str, intent: AtomicIntent) -> bool:
    if not utterance:
        return False
    blocked = (
        (intent_suggests_atomic_create(intent) and not explore_explicit_intent(utterance))
        or single_node_gen_intent(utterance)
        or regenerate_phrase_intent(utterance)
        or atomic_regenerate_intent(utterance)
    )
    return blocked


def orchestration_campaign_signal(utterance: str) -> bool:
    """High-complexity orchestration without Skill → clarify_route (§9.13, no bool classifier)."""
    t = (utterance or "").strip()
    if not t:
        return False
    if _has_orchestration_phrases(t):
        return True
    from app.graph.planning_guard import detect_action, is_planning_intent

    if "详情页" in t and is_planning_intent(t) and detect_action(t) != "write":
        return True
    from app.graph.atomic_intent import _parse_orch_count, _storyboard_shot_count

    shots = _storyboard_shot_count(t)
    if shots is not None and shots >= 4:
        return True
    if "分镜" in t and any(x in t for x in ("12", "十二", "整套", "全套")):
        return True
    return False


def extract_route_features(ctx: RouteContext, intent: AtomicIntent) -> RouteFeatures:
    """Derive L0 routing features — no flow_mode decisions here."""
    utterance = str(ctx.get("utterance") or intent.utterance or "").strip()
    keys = list(ctx.get("mentioned_keys") or [])
    attachments = ctx.get("sidebar_attachments") or []

    text_keys = _text_keys(keys)
    image_keys = _image_keys(keys)
    has_text_attachment = any(
        str(a.get("mediaType") or "").lower() == "text" for a in attachments
    )
    has_image_attachment = any(
        str(a.get("mediaType") or "").lower() == "image" for a in attachments
    )

    checkpoint = ctx.get("checkpoint") or {}
    atomic_node_id = str(checkpoint.get("atomic_node_id") or ctx.get("atomic_node_id") or "").strip()
    atomic_spec = checkpoint.get("atomic_spec") or ctx.get("atomic_spec")
    has_checkpoint = bool(atomic_node_id and isinstance(atomic_spec, dict))

    multi_image = (
        len(image_keys) >= 2
        or utterance_has_multi_image_refs(utterance)
        or sum(1 for a in attachments if str(a.get("mediaType") or "").lower() == "image") >= 2
    )

    return RouteFeatures(
        has_text_ref=bool(text_keys or has_text_attachment),
        has_image_ref=bool(image_keys or has_image_attachment),
        has_multi_image_ref=multi_image,
        explicit_skill=bool(str(ctx.get("requested_skill_id") or "").strip()),
        has_atomic_checkpoint=has_checkpoint,
        preserve_composition=has_preserve_intent(utterance),
        orchestration_phrases=_has_orchestration_phrases(utterance),
        modality_conflict_risk=has_planning_image_conflict(utterance)
        and not has_preserve_intent(utterance),
        explore_blocked=_explore_blocked(utterance, intent),
    )
