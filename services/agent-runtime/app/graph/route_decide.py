"""Platform L1 route_decide — atomic-first signal table."""

from __future__ import annotations

import re
from typing import Literal, TypedDict

from app.graph.atomic_intent import (
    atomic_create_intent,
    atomic_regenerate_intent,
    is_regenerate_new_variant,
    orchestration_complexity_intent,
    regenerate_phrase_intent,
    resolve_intake_route,
)
from app.graph.atomic_intent_ir import is_ref_media_generation, resolve_output_modality
from app.graph.explore_route import explore_canvas_signal, explore_explicit_intent
from app.graph.intent import modify_intent, single_node_gen_intent
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
    "听起来像多节点编排或 Skill 工作流需求。请确认：\n"
    "1）按引用内容单张出图（保留 @T* / @I*）；\n"
    "2）完整编排（请先在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)

RouteFlowMode = Literal[
    "atomic_create",
    "atomic_regenerate",
    "single_node",
    "campaign",
    "explore_canvas",
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


def _text_mentioned_keys(keys: list[str]) -> list[str]:
    return [k for k in keys if k.upper().startswith("T")]


def _sidebar_ref_atomic_signal(ctx: RouteContext) -> bool:
    """T/I ref + image/video generate utterance → atomic (explicit-skill model)."""
    utterance = str(ctx.get("utterance") or "").strip()
    if not utterance:
        return False
    keys = list(ctx.get("mentioned_keys") or [])
    text_keys = _text_mentioned_keys(keys)
    attachments = ctx.get("sidebar_attachments") or []
    has_ref = bool(text_keys or keys) or any(
        str(a.get("mediaType") or "").lower() in ("text", "image") for a in attachments
    )
    if not has_ref:
        return False
    mk = keys or None
    if is_ref_media_generation(utterance, mk):
        return True
    modality = resolve_output_modality(utterance, mentioned_keys=mk)
    if modality in ("image", "video") and (
        "出图" in utterance or "生成图" in utterance or re.search(r"按?风格\s*\d+", utterance)
    ):
        return True
    return False


def _explore_canvas_signal(ctx: RouteContext) -> bool:
    utterance = str(ctx.get("utterance") or "").strip()
    if not utterance:
        return False
    blocked = (
        (atomic_create_intent(utterance) and not explore_explicit_intent(utterance))
        or single_node_gen_intent(utterance)
        or regenerate_phrase_intent(utterance)
        or atomic_regenerate_intent(utterance)
    )
    return explore_canvas_signal(utterance, blocked_by_atomic=blocked)


def _sidebar_img2img_signal(ctx: RouteContext) -> bool:
    utterance = str(ctx.get("utterance") or "")
    keys = _image_mentioned_keys(ctx.get("mentioned_keys") or [])
    if not utterance:
        return False
    has_transform = any(v in utterance for v in TRANSFORM_VERBS) or (
        len(keys) >= 2 and ("让" in utterance or "请" in utterance)
    )
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

    if _sidebar_ref_atomic_signal(ctx):
        return {
            "flow_mode": "atomic_create",
            "l0_action": l0,
            "confidence": 0.92,
            "reason": "sidebar_ref_atomic",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    route = resolve_intake_route(utterance, focus_node_id=focus)
    orch = orchestration_complexity_intent(utterance)
    is_atomic = route == "atomic_create" or atomic_create_intent(utterance)
    is_variant = has_checkpoint and is_regenerate_new_variant(utterance)

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

    if skill_id:
        return {
            "flow_mode": "campaign",
            "l0_action": l0,
            "confidence": 0.90,
            "reason": "explicit_skill_orchestration",
            "clarify_question": None,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    if guard_veto or (orch == "campaign" and not skill_id):
        return {
            "flow_mode": "clarify_route",
            "l0_action": l0,
            "confidence": 0.75,
            "reason": "orchestration_without_skill",
            "clarify_question": ROUTE_CLARIFY_ORCHESTRATION,
            "guard_veto": guard_veto,
            "is_modify": False,
        }

    # Explore before atomic: existing-node read/write must not hijack atomic_create.
    if _explore_canvas_signal(ctx):
        return {
            "flow_mode": "explore_canvas",
            "l0_action": l0,
            "confidence": 0.88,
            "reason": "explore_canvas_intent",
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
