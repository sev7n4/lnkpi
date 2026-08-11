"""Presentation envelope builder for product_visual v2 sidebar UX."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_copy import ProductVisualCopy

STEPPER_ORDER: list[str] = [
    "image_qa",
    "scheme_draft",
    "macro_select",
    "ssot_persist",
    "shot_plan",
    "topo_preview",
    "generating",
    "delivery",
    "done",
]

PHASE_TO_STEPPER: dict[str, str] = {
    "await_image_qa": "image_qa",
    "image_qa_check": "image_qa",
    "dialog_draft": "scheme_draft",
    "await_scheme_select": "scheme_draft",
    "plan_product_visual": "scheme_draft",
    "await_macro_scheme_select": "macro_select",
    "canvas_ssot_commit": "ssot_persist",
    "decompose_from_ssot": "ssot_persist",
    "await_shot_confirm": "shot_plan",
    "await_topo": "topo_preview",
    "orchestrate_gen": "generating",
    "orchestrate_shots": "generating",
    "collect_gen": "generating",
    "await_delivery_confirm": "delivery",
    "done": "done",
}


def phase_to_stepper(phase: str) -> str:
    """Map runtime phase / gate id to stepper step id."""
    if phase in PHASE_TO_STEPPER:
        return PHASE_TO_STEPPER[phase]
    if phase.startswith("await_"):
        stripped = phase.removeprefix("await_")
        if stripped in STEPPER_ORDER:
            return stripped
    return "scheme_draft"


def _completed_steps(current: str) -> list[str]:
    if current not in STEPPER_ORDER:
        return []
    idx = STEPPER_ORDER.index(current)
    return STEPPER_ORDER[:idx]


def build_context_recap(state: dict[str, Any]) -> str:
    """Render ≤120 char demand summary from visual_intent / utterance."""
    intent = state.get("visual_intent") or {}
    primary = str(intent.get("primary_goal") or "").strip()
    route = state.get("route_context") or {}
    utterance = str(route.get("utterance") or "").strip()

    recap = primary or utterance
    if not recap:
        return ""
    return recap[:120]


def build_presentation_envelope(
    *,
    kind: str,
    phase: str,
    state: dict[str, Any],
    copy: ProductVisualCopy,
) -> dict[str, Any]:
    """Build structured presentation envelope for sidebar rendering."""
    _ = copy  # reserved for P0-1+ body/action copy
    current = phase_to_stepper(phase)
    envelope: dict[str, Any] = {
        "kind": kind,
        "stepper": {
            "current": current,
            "completed": _completed_steps(current),
        },
        "context_recap": build_context_recap(state),
    }
    return envelope
