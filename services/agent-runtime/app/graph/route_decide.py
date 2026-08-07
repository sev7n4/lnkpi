"""Platform L1 route_decide — atomic-first signal table."""

from __future__ import annotations

from typing import Literal, TypedDict

from app.graph.atomic_intent import (
    atomic_create_intent,
    atomic_regenerate_intent,
    is_regenerate_new_variant,
    orchestration_complexity_intent,
    regenerate_phrase_intent,
    resolve_intake_route,
)
from app.graph.intent import marketing_intent, modify_intent, single_node_gen_intent
from app.graph.l0_action import (
    TRANSFORM_VERBS,
    detect_l0_action,
    has_preserve_intent,
    utterance_has_multi_image_refs,
)
from app.graph.planning_guard import ActionKind, has_planning_image_conflict
from app.graph.route_context import RouteContext

CLARIFY_THRESHOLD = 0.70

ROUTE_CLARIFY_ORCHESTRATION = (
    "听起来像多节点编排或营销方案需求。请确认：\n"
    "1）单张/图生图原子出图；\n"
    "2）完整编排（请在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)

RouteFlowMode = Literal[
    "atomic_create",
    "atomic_regenerate",
    "single_node",
    "campaign",
    "chat",
    "clarify_route",
]


class RouteDecision(TypedDict, total=False):
    flow_mode: RouteFlowMode
    l0_action: ActionKind
    confidence: float
    reason: str
    clarify_question: str | None
    guard_veto: str | None
    is_modify: bool


def _image_attachment_count(attachments: list[dict]) -> int:
    count = 0
    for item in attachments:
        mt = str(item.get("mediaType") or item.get("media_type") or item.get("kind") or "").lower()
        if mt == "image" or (not mt and item.get("url")):
            count += 1
    return count


def _image_mentioned_keys(keys: list[str]) -> list[str]:
    return [k for k in keys if k.upper().startswith("I")]


def _sidebar_img2img_signal(ctx: RouteContext) -> bool:
    utterance = str(ctx.get("utterance") or "")
    keys = _image_mentioned_keys(ctx.get("mentioned_keys") or [])
    if not utterance:
        return False
    has_transform = any(v in utterance for v in TRANSFORM_VERBS)
    if not has_transform and not has_preserve_intent(utterance):
        return False
    multi_ref = len(keys) >= 2 or utterance_has_multi_image_refs(utterance)
    if not multi_ref:
        return False
    attachments = ctx.get("sidebar_attachments") or []
    if attachments:
        return _image_attachment_count(attachments) >= 2 or len(keys) >= 2
    return len(keys) >= 2 or utterance_has_multi_image_refs(utterance)


def decide_route(ctx: RouteContext, *, valid_skill_ids: set[str] | None = None) -> RouteDecision:
    utterance = str(ctx.get("utterance") or "").strip()
    focus = ctx.get("focus_node_id")
    checkpoint = ctx.get("checkpoint") or {}
    requested = str(ctx.get("requested_skill_id") or "").strip()
    skill_id = requested if requested and (not valid_skill_ids or requested in valid_skill_ids) else None

    l0 = detect_l0_action(utterance)
    guard_veto: str | None = None
    if has_planning_image_conflict(utterance) and not has_preserve_intent(utterance):
        guard_veto = "planning_image_conflict"

    atomic_node_id = str(checkpoint.get("atomic_node_id") or "").strip()
    atomic_spec = checkpoint.get("atomic_spec")
    has_checkpoint = bool(atomic_node_id and isinstance(atomic_spec, dict))
    user_brief = checkpoint.get("user_brief")
    plan_draft = checkpoint.get("plan_draft")

    if user_brief and plan_draft and modify_intent(utterance) and not single_node_gen_intent(utterance):
        return {
            "flow_mode": "campaign",
            "l0_action": l0,
            "confidence": 0.92,
            "reason": "modify_existing_plan",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": True,
        }

    if not has_checkpoint and regenerate_phrase_intent(utterance):
        return {
            "flow_mode": "clarify_route",
            "l0_action": l0,
            "confidence": 0.95,
            "reason": "regen_no_checkpoint",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if has_checkpoint and atomic_regenerate_intent(utterance):
        return {
            "flow_mode": "atomic_regenerate",
            "l0_action": l0,
            "confidence": 0.96,
            "reason": "atomic_regenerate_checkpoint",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if _sidebar_img2img_signal(ctx):
        return {
            "flow_mode": "atomic_create",
            "l0_action": l0,
            "confidence": 0.95,
            "reason": "sidebar_img2img_p1",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    route = resolve_intake_route(utterance, focus_node_id=focus)
    orch = orchestration_complexity_intent(utterance)
    is_atomic = route == "atomic_create" or atomic_create_intent(utterance)
    is_variant = has_checkpoint and is_regenerate_new_variant(utterance)

    if orch == "campaign" and (is_atomic or is_variant):
        preserve_or_img2img = has_preserve_intent(utterance) or (
            utterance_has_multi_image_refs(utterance) and any(v in utterance for v in TRANSFORM_VERBS)
        )
        if not preserve_or_img2img:
            is_atomic = False
            is_variant = False
            route = "campaign"

    if focus and route == "single_node" and single_node_gen_intent(utterance) and not modify_intent(utterance):
        return {
            "flow_mode": "single_node",
            "l0_action": l0,
            "confidence": 0.93,
            "reason": "single_node_focus",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if skill_id and (marketing_intent(utterance) or route == "campaign" or orch == "campaign"):
        return {
            "flow_mode": "campaign",
            "l0_action": l0,
            "confidence": 0.90,
            "reason": "explicit_skill_orchestration",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if is_atomic or is_variant or (has_preserve_intent(utterance) and l0 in ("preserve", "generate", "unknown")):
        return {
            "flow_mode": "atomic_create",
            "l0_action": l0,
            "confidence": 0.88,
            "reason": "atomic_create_intent",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if marketing_intent(utterance) or (orch == "campaign" and route == "campaign") or guard_veto:
        return {
            "flow_mode": "clarify_route",
            "l0_action": l0,
            "confidence": 0.75,
            "reason": "orchestration_without_skill",
            "clarify_question": ROUTE_CLARIFY_ORCHESTRATION,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if not utterance:
        return {
            "flow_mode": "chat",
            "l0_action": "unknown",
            "confidence": 0.50,
            "reason": "empty_utterance",
            "clarify_question": None,
            "guard_veto": None,
            "is_modify": False,
        }

    return {
        "flow_mode": "chat",
        "l0_action": l0,
        "confidence": 0.80,
        "reason": "default_chat",
        "clarify_question": None,
        "guard_veto": guard_veto,
        "is_modify": False,
    }
