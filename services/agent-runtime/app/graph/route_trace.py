"""Serialize RouteDecision for LangGraph state and SSE execution trace (§9.14)."""

from __future__ import annotations

from typing import Any

from app.graph.atomic_intent_ir import AtomicIntent
from app.graph.route_decide import RouteDecision


def atomic_intent_snapshot(intent: AtomicIntent | None) -> dict[str, Any] | None:
    if intent is None:
        return None
    return {
        "action": intent.action,
        "output_modality": intent.output_modality,
        "utterance": intent.utterance,
        "source_markers": list(intent.source_markers),
        "mentioned_keys": list(intent.mentioned_keys),
    }


def serialize_route_decision(decision: RouteDecision | dict[str, Any]) -> dict[str, Any]:
    """JSON-friendly route decision payload for state + trace."""
    raw = dict(decision)
    out: dict[str, Any] = {}
    for key in (
        "flow_mode",
        "l0_action",
        "confidence",
        "reason",
        "clarify_question",
        "guard_veto",
        "is_modify",
        "precedence_rule_id",
    ):
        if key in raw and raw[key] is not None:
            out[key] = raw[key]

    features = raw.get("route_features")
    if isinstance(features, dict):
        out["route_features"] = dict(features)

    intent = raw.get("atomic_intent")
    if isinstance(intent, AtomicIntent):
        out["atomic_intent"] = atomic_intent_snapshot(intent)
    elif isinstance(intent, dict):
        out["atomic_intent"] = intent

    return out


def route_decision_event(decision: RouteDecision | dict[str, Any]) -> dict[str, Any]:
    payload = serialize_route_decision(decision)
    return {
        "type": "route_decision",
        "data": {
            "route_decision": payload,
            "precedence_rule_id": payload.get("precedence_rule_id"),
            "route_features": payload.get("route_features"),
            "atomic_intent": payload.get("atomic_intent"),
        },
    }
