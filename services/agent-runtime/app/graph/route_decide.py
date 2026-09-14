"""Platform L1 route_decide — hard short-circuit + optional decide_lane (M3b)."""

from __future__ import annotations

import logging
from typing import Any, Literal, Sequence, TypedDict

from app.config import settings
from app.graph.atomic_intent_ir import AtomicIntent, resolve_atomic_intent
from app.graph.clarify_reply import ClarifyReplyResult
from app.graph.decide_lane import (
    apply_decide_lane_postprocess,
    decide_lane_llm,
)
from app.graph.l0_action import detect_l0_action
from app.graph.planning_guard import ActionKind
from app.graph.recent_turns import compress_recent_turns
from app.graph.route_context import RouteContext
from app.graph.route_features import RouteFeatures, extract_route_features
from app.graph.route_hard import apply_hard_shortcircuit
from app.graph.route_precedence import ROUTE_CLARIFY_ORCHESTRATION, apply_route_precedence

logger = logging.getLogger(__name__)

RouteFlowMode = Literal[
    "atomic_create",
    "atomic_regenerate",
    "single_node",
    "campaign",
    "product_visual",
    "explore_canvas",
    "canvas_agent",
    "chat",  # compat alias → canvas_agent / explore node
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
    precedence_rule_id: str
    atomic_intent: AtomicIntent
    route_features: RouteFeatures


def _decision_from_raw(
    raw: dict[str, Any],
    *,
    intent: AtomicIntent,
    features: RouteFeatures,
) -> RouteDecision:
    return RouteDecision(
        flow_mode=raw["flow_mode"],  # type: ignore[typeddict-item]
        l0_action=raw["l0_action"],
        confidence=raw["confidence"],
        reason=raw["reason"],
        clarify_question=raw.get("clarify_question"),
        guard_veto=raw.get("guard_veto"),
        is_modify=raw.get("is_modify", False),
        precedence_rule_id=raw.get("precedence_rule_id"),
        atomic_intent=intent,
        route_features=features,
    )


def _canvas_agent_fallback(
    ctx: RouteContext,
    *,
    intent: AtomicIntent,
    features: RouteFeatures,
    reason: str = "decide_lane_fallback",
) -> RouteDecision:
    utterance = str(ctx.get("utterance") or "")
    return RouteDecision(
        flow_mode="canvas_agent",
        l0_action=detect_l0_action(utterance),
        confidence=0.5,
        reason=reason,
        clarify_question=None,
        guard_veto=None,
        is_modify=False,
        precedence_rule_id="decide_lane_fallback",
        atomic_intent=intent,
        route_features=features,
    )


def _from_decide_lane(
    ctx: RouteContext,
    *,
    intent: AtomicIntent,
    features: RouteFeatures,
    lane: str,
    confidence: float,
    reason: str,
    clarify_question: str | None,
) -> RouteDecision:
    utterance = str(ctx.get("utterance") or "")
    return RouteDecision(
        flow_mode=lane,  # type: ignore[typeddict-item]
        l0_action=detect_l0_action(utterance),
        confidence=confidence,
        reason=reason,
        clarify_question=clarify_question,
        guard_veto=None,
        is_modify=False,
        precedence_rule_id="decide_lane",
        atomic_intent=intent,
        route_features=features,
    )


def _clarify_resume_decision(
    ctx: RouteContext,
    *,
    intent: AtomicIntent,
    features: RouteFeatures,
    pending_clarify_reply: ClarifyReplyResult | None,
) -> RouteDecision | None:
    if not pending_clarify_reply or pending_clarify_reply == "none":
        return None
    route = str(pending_clarify_reply.get("route") or "atomic_create")
    flow = "campaign" if route == "campaign" else "atomic_create"
    utterance = str(ctx.get("utterance") or "")
    return RouteDecision(
        flow_mode=flow,  # type: ignore[typeddict-item]
        l0_action=detect_l0_action(utterance),
        confidence=0.91,
        reason="clarify_resume",
        clarify_question=None,
        guard_veto=None,
        is_modify=False,
        precedence_rule_id="clarify_resume",
        atomic_intent=intent,
        route_features=features,
    )


def _resolve_previous_lane(
    ctx: RouteContext,
    previous_lane: str | None,
) -> str | None:
    if previous_lane:
        return previous_lane
    checkpoint = ctx.get("checkpoint") or {}
    prev = checkpoint.get("flow_mode_prev")
    return str(prev).strip() or None if prev else None


def decide_route_unified(
    ctx: RouteContext,
    *,
    valid_skill_ids: set[str] | None = None,
    pending_clarify_reply: ClarifyReplyResult | None = None,
    llm: Any | None = None,
    messages: Sequence[Any] | None = None,
    previous_lane: str | None = None,
    route_llm_primary: bool | None = None,
    route_llm_shadow: bool | None = None,
) -> RouteDecision:
    utterance = str(ctx.get("utterance") or "").strip()
    keys = list(ctx.get("mentioned_keys") or [])
    intent = resolve_atomic_intent(utterance, mentioned_keys=keys or None)
    features = extract_route_features(ctx, intent)

    primary = (
        settings.route_llm_primary if route_llm_primary is None else route_llm_primary
    )
    shadow = settings.route_llm_shadow if route_llm_shadow is None else route_llm_shadow

    # Flag off: precedence table (explore noun rule retired in M4 → canvas_agent).
    if not primary:
        raw = apply_route_precedence(
            intent,
            features,
            ctx,
            pending_clarify_reply=pending_clarify_reply,
            valid_skill_ids=valid_skill_ids,
        )
        decision = _decision_from_raw(raw, intent=intent, features=features)
        if shadow and llm is not None:
            try:
                recent = compress_recent_turns(list(messages or []))
                _ = decide_lane_llm(
                    llm,
                    utterance,
                    recent_turns=recent,
                    route_features=features,
                    previous_lane=_resolve_previous_lane(ctx, previous_lane),
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("route_llm_shadow sample failed: %s", exc)
        return decision

    # M3b primary pipeline: clarify_resume → hard → decide_lane → canvas_agent
    resumed = _clarify_resume_decision(
        ctx,
        intent=intent,
        features=features,
        pending_clarify_reply=pending_clarify_reply,
    )
    if resumed is not None:
        return resumed

    hard = apply_hard_shortcircuit(
        intent,
        features,
        ctx,
        valid_skill_ids=valid_skill_ids,
    )
    if hard is not None:
        return _decision_from_raw(hard, intent=intent, features=features)

    recent = compress_recent_turns(list(messages or []))
    prev = _resolve_previous_lane(ctx, previous_lane)
    parsed = decide_lane_llm(
        llm,
        utterance,
        recent_turns=recent,
        route_features=features,
        previous_lane=prev,
    )
    if parsed is None:
        return _canvas_agent_fallback(ctx, intent=intent, features=features)

    processed = apply_decide_lane_postprocess(parsed)
    lane = processed.get("lane") or "canvas_agent"
    return _from_decide_lane(
        ctx,
        intent=intent,
        features=features,
        lane=lane,
        confidence=float(processed.get("confidence") or 0.0),
        reason=str(processed.get("reason") or "decide_lane"),
        clarify_question=processed.get("clarify_question"),
    )


def decide_route(
    ctx: RouteContext,
    *,
    valid_skill_ids: set[str] | None = None,
    pending_clarify_reply: ClarifyReplyResult | None = None,
    llm: Any | None = None,
    messages: Sequence[Any] | None = None,
    previous_lane: str | None = None,
    route_llm_primary: bool | None = None,
    route_llm_shadow: bool | None = None,
) -> RouteDecision:
    return decide_route_unified(
        ctx,
        valid_skill_ids=valid_skill_ids,
        pending_clarify_reply=pending_clarify_reply,
        llm=llm,
        messages=messages,
        previous_lane=previous_lane,
        route_llm_primary=route_llm_primary,
        route_llm_shadow=route_llm_shadow,
    )
