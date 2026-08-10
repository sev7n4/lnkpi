"""P1: L0 precedence table — single conflict resolution protocol (RU-4, RU-5)."""

from __future__ import annotations

import re
from typing import Any, Callable

from app.graph.atomic_intent import (
    atomic_regenerate_intent,
    is_regenerate_new_variant,
    regenerate_phrase_intent,
    resolve_intake_route,
)
from app.graph.atomic_intent_ir import AtomicIntent, intent_suggests_atomic_create, is_ref_media_generation
from app.graph.clarify_reply import ClarifyReplyResult, classify_clarify_reply
from app.graph.explore_route import explore_canvas_signal
from app.graph.intent import modify_intent, single_node_gen_intent
from app.graph.l0_action import TRANSFORM_VERBS, detect_l0_action, has_preserve_intent
from app.graph.route_context import RouteContext
from app.graph.route_features import RouteFeatures, orchestration_campaign_signal

ROUTE_CLARIFY_ORCHESTRATION = (
    "听起来像多节点编排或 Skill 工作流需求。请确认：\n"
    "1）按引用内容单张出图（保留 @T* / @I*）；\n"
    "2）完整编排（请先在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)

RuleFn = Callable[
    [AtomicIntent, RouteFeatures, RouteContext, set[str] | None],
    dict[str, Any] | None,
]


def _base_decision(
    ctx: RouteContext,
    *,
    flow_mode: str,
    reason: str,
    confidence: float,
    precedence_rule_id: str,
    clarify_question: str | None = None,
    guard_veto: str | None = None,
    is_modify: bool = False,
    intent: AtomicIntent | None = None,
    features: RouteFeatures | None = None,
) -> dict[str, Any]:
    utterance = str(ctx.get("utterance") or "")
    decision: dict[str, Any] = {
        "flow_mode": flow_mode,  # type: ignore[typeddict-item]
        "l0_action": detect_l0_action(utterance),
        "confidence": confidence,
        "reason": reason,
        "clarify_question": clarify_question,
        "guard_veto": guard_veto,
        "is_modify": is_modify,
        "precedence_rule_id": precedence_rule_id,
    }
    if intent is not None:
        decision["atomic_intent"] = intent  # type: ignore[typeddict-unknown-key]
    if features is not None:
        decision["route_features"] = features  # type: ignore[typeddict-unknown-key]
    return decision


def _valid_skill_id(ctx: RouteContext, valid_skill_ids: set[str] | None) -> str | None:
    requested = str(ctx.get("requested_skill_id") or "").strip()
    if not requested:
        return None
    if valid_skill_ids and requested not in valid_skill_ids:
        return None
    return requested


def _guard_veto(ctx: RouteContext) -> str | None:
    utterance = str(ctx.get("utterance") or "")
    if has_planning_image_conflict(utterance) and not has_preserve_intent(utterance):
        return "planning_image_conflict"
    return None


def has_planning_image_conflict(utterance: str) -> bool:
    from app.graph.planning_guard import has_planning_image_conflict as _conflict

    return _conflict(utterance)


def _sidebar_img2img_match(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext
) -> bool:
    utterance = intent.utterance
    if not features.get("has_multi_image_ref"):
        return False
    keys = list(ctx.get("mentioned_keys") or [])
    image_keys = [k for k in keys if str(k).upper().startswith("I")]
    has_transform = any(v in utterance for v in TRANSFORM_VERBS) or (
        len(image_keys) >= 2 and ("让" in utterance or "请" in utterance)
    )
    return has_transform or bool(features.get("preserve_composition"))


def _ref_backed_generate_match(intent: AtomicIntent, features: RouteFeatures) -> bool:
    has_ref = bool(features.get("has_text_ref") or features.get("has_image_ref"))
    if not has_ref:
        return False
    mk = list(intent.mentioned_keys) or None
    if is_ref_media_generation(intent.utterance, mk):
        return True
    if intent.action == "generate" and intent.output_modality in ("image", "video"):
        if "出图" in intent.utterance or "生成图" in intent.utterance or re.search(
            r"按?风格\s*\d+", intent.utterance
        ):
            return True
    return intent.action == "generate" and intent.output_modality in ("image", "video") and has_ref


def _explore_match(intent: AtomicIntent, features: RouteFeatures) -> bool:
    utterance = intent.utterance
    if not utterance:
        return False
    blocked = bool(features.get("explore_blocked"))
    return explore_canvas_signal(utterance, blocked_by_atomic=blocked)


def _rule_modify_existing_plan(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    checkpoint = ctx.get("checkpoint") or {}
    utterance = intent.utterance
    if (
        checkpoint.get("user_brief")
        and checkpoint.get("plan_draft")
        and modify_intent(utterance)
        and not single_node_gen_intent(utterance)
    ):
        return _base_decision(
            ctx,
            flow_mode="campaign",
            reason="modify_existing_plan",
            confidence=0.92,
            precedence_rule_id="modify_existing_plan",
            guard_veto=_guard_veto(ctx),
            is_modify=True,
            intent=intent,
            features=features,
        )
    return None


def _rule_regen_no_checkpoint(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if not features.get("has_atomic_checkpoint") and regenerate_phrase_intent(intent.utterance):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="regen_no_checkpoint",
            confidence=0.95,
            precedence_rule_id="regen_no_checkpoint",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_checkpoint_regen(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if features.get("has_atomic_checkpoint") and atomic_regenerate_intent(intent.utterance):
        return _base_decision(
            ctx,
            flow_mode="atomic_regenerate",
            reason="atomic_regenerate_checkpoint",
            confidence=0.96,
            precedence_rule_id="checkpoint_regen",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_sidebar_img2img(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _sidebar_img2img_match(intent, features, ctx):
        return _base_decision(
            ctx,
            flow_mode="atomic_create",
            reason="sidebar_img2img_p1",
            confidence=0.95,
            precedence_rule_id="sidebar_img2img",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_ref_backed_generate(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _ref_backed_generate_match(intent, features):
        return _base_decision(
            ctx,
            flow_mode="atomic_create",
            reason="sidebar_ref_atomic",
            confidence=0.92,
            precedence_rule_id="ref_backed_generate",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_focus_gen(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    focus = ctx.get("focus_node_id")
    utterance = intent.utterance
    route = resolve_intake_route(utterance, focus_node_id=focus)
    if (
        focus
        and route == "single_node"
        and single_node_gen_intent(utterance)
        and not modify_intent(utterance)
    ):
        return _base_decision(
            ctx,
            flow_mode="single_node",
            reason="single_node_focus",
            confidence=0.93,
            precedence_rule_id="focus_gen",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_explicit_skill(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _valid_skill_id(ctx, valid_skill_ids):
        return _base_decision(
            ctx,
            flow_mode="campaign",
            reason="explicit_skill_orchestration",
            confidence=0.90,
            precedence_rule_id="explicit_skill_orch",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_orch_ambiguous(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    guard = _guard_veto(ctx)
    orch = orchestration_campaign_signal(intent.utterance)
    if guard or (orch and not _valid_skill_id(ctx, valid_skill_ids)):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="orchestration_without_skill",
            confidence=0.75,
            precedence_rule_id="orch_ambiguous",
            clarify_question=ROUTE_CLARIFY_ORCHESTRATION,
            guard_veto=guard,
            intent=intent,
            features=features,
        )
    return None


def _rule_explore(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _explore_match(intent, features):
        return _base_decision(
            ctx,
            flow_mode="explore_canvas",
            reason="explore_canvas_intent",
            confidence=0.88,
            precedence_rule_id="explore",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_atomic_generate(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    utterance = intent.utterance
    l0 = detect_l0_action(utterance)
    route = resolve_intake_route(utterance, focus_node_id=ctx.get("focus_node_id"))
    is_variant = bool(features.get("has_atomic_checkpoint")) and is_regenerate_new_variant(utterance)
    is_atomic = route == "atomic_create" or intent_suggests_atomic_create(intent)
    if is_atomic or is_variant or (
        has_preserve_intent(utterance) and l0 in ("preserve", "generate", "unknown")
    ):
        return _base_decision(
            ctx,
            flow_mode="atomic_create",
            reason="atomic_create_intent",
            confidence=0.88,
            precedence_rule_id="atomic_generate",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_empty(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if not intent.utterance.strip():
        return _base_decision(
            ctx,
            flow_mode="chat",
            reason="empty_utterance",
            confidence=0.50,
            precedence_rule_id="empty",
            guard_veto=None,
            intent=intent,
            features=features,
        )
    return None


def _rule_default_chat(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    return _base_decision(
        ctx,
        flow_mode="chat",
        reason="default_chat",
        confidence=0.80,
        precedence_rule_id="default_chat",
        guard_veto=_guard_veto(ctx),
        intent=intent,
        features=features,
    )


PRECEDENCE_RULES: list[tuple[str, RuleFn]] = [
    ("modify_existing_plan", _rule_modify_existing_plan),
    ("regen_no_checkpoint", _rule_regen_no_checkpoint),
    ("sidebar_img2img", _rule_sidebar_img2img),
    ("checkpoint_regen", _rule_checkpoint_regen),
    ("ref_backed_generate", _rule_ref_backed_generate),
    ("focus_gen", _rule_focus_gen),
    ("explicit_skill_orch", _rule_explicit_skill),
    ("orch_ambiguous", _rule_orch_ambiguous),
    ("explore", _rule_explore),
    ("atomic_generate", _rule_atomic_generate),
    ("empty", _rule_empty),
    ("default_chat", _rule_default_chat),
]


def apply_route_precedence(
    intent: AtomicIntent,
    features: RouteFeatures,
    ctx: RouteContext,
    *,
    pending_clarify_reply: ClarifyReplyResult | None = None,
    valid_skill_ids: set[str] | None = None,
) -> dict[str, Any]:
    """First matching precedence rule wins (design §9.9)."""
    if pending_clarify_reply and pending_clarify_reply != "none":
        route = str(pending_clarify_reply.get("route") or "atomic_create")
        flow = "campaign" if route == "campaign" else "atomic_create"
        return _base_decision(
            ctx,
            flow_mode=flow,
            reason="clarify_resume",
            confidence=0.91,
            precedence_rule_id="clarify_resume",
            intent=intent,
            features=features,
        )

    for _rule_id, fn in PRECEDENCE_RULES:
        decision = fn(intent, features, ctx, valid_skill_ids)
        if decision is not None:
            return decision

    return _rule_default_chat(intent, features, ctx, valid_skill_ids)  # type: ignore[return-value]


def classify_pending_clarify_reply(
    original_utterance: str,
    clarify_question: str,
    user_reply: str,
    *,
    checkpoint: dict | None = None,
) -> ClarifyReplyResult:
    return classify_clarify_reply(
        original_utterance, clarify_question, user_reply, checkpoint=checkpoint
    )
