"""Platform L1 route_decide — unified precedence router (P1c)."""

from __future__ import annotations

from typing import Literal, TypedDict

from app.graph.atomic_intent_ir import AtomicIntent, resolve_atomic_intent
from app.graph.clarify_reply import ClarifyReplyResult
from app.graph.planning_guard import ActionKind
from app.graph.route_context import RouteContext
from app.graph.route_features import RouteFeatures, extract_route_features
from app.graph.route_precedence import ROUTE_CLARIFY_ORCHESTRATION, apply_route_precedence

RouteFlowMode = Literal[
    "atomic_create",
    "atomic_regenerate",
    "single_node",
    "campaign",
    "product_visual",
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
    precedence_rule_id: str
    atomic_intent: AtomicIntent
    route_features: RouteFeatures


def decide_route_unified(
    ctx: RouteContext,
    *,
    valid_skill_ids: set[str] | None = None,
    pending_clarify_reply: ClarifyReplyResult | None = None,
) -> RouteDecision:
    utterance = str(ctx.get("utterance") or "").strip()
    keys = list(ctx.get("mentioned_keys") or [])
    intent = resolve_atomic_intent(utterance, mentioned_keys=keys or None)
    features = extract_route_features(ctx, intent)
    raw = apply_route_precedence(
        intent,
        features,
        ctx,
        pending_clarify_reply=pending_clarify_reply,
        valid_skill_ids=valid_skill_ids,
    )
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


def decide_route(
    ctx: RouteContext,
    *,
    valid_skill_ids: set[str] | None = None,
    pending_clarify_reply: ClarifyReplyResult | None = None,
) -> RouteDecision:
    return decide_route_unified(
        ctx,
        valid_skill_ids=valid_skill_ids,
        pending_clarify_reply=pending_clarify_reply,
    )
