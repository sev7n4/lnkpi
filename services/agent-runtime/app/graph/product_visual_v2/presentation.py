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


def _shot_count(state: dict[str, Any]) -> int:
    shots = state.get("shot_manifest") or []
    if not isinstance(shots, list):
        return 0
    return len([s for s in shots if isinstance(s, dict)])


def _scene_count(state: dict[str, Any]) -> int:
    manifest = state.get("split_manifest") or []
    if isinstance(manifest, list) and manifest:
        downstream = [
            it
            for it in manifest
            if isinstance(it, dict) and str(it.get("role") or "") == "downstream"
        ]
        if downstream:
            return len(downstream)
    shots = state.get("shot_manifest") or []
    if not isinstance(shots, list):
        return 0
    total = 0
    for shot in shots:
        if isinstance(shot, dict):
            total += max(1, min(3, int(shot.get("variant_count") or 1)))
    return total


def _eta_min(scene_count: int) -> int:
    if scene_count <= 0:
        return 3
    return max(3, 2 + scene_count)


def build_presentation_envelope(
    *,
    kind: str,
    phase: str,
    state: dict[str, Any],
    copy: ProductVisualCopy,
) -> dict[str, Any]:
    """Build structured presentation envelope for sidebar rendering."""
    current = phase_to_stepper(phase)
    envelope: dict[str, Any] = {
        "kind": kind,
        "stepper": {
            "current": current,
            "completed": _completed_steps(current),
        },
        "context_recap": build_context_recap(state),
    }

    if phase == "await_shot_confirm":
        n = _shot_count(state)
        hint = copy.get("shot_confirm.hint", n=str(n))
        label = copy.get("shot_confirm.primary_label")
        envelope["primary_action"] = {"label": label, "message": "确认出图"}
        envelope["body"] = {"text": hint}
    elif phase == "await_topo":
        scene_count = _scene_count(state)
        eta_min = _eta_min(scene_count)
        hint = copy.get("topo.hint", scene_count=str(scene_count))
        label = copy.get("topo.primary_label", eta_min=str(eta_min))
        envelope["primary_action"] = {"label": label, "message": "确认出图"}
        envelope["body"] = {"text": hint}

    return envelope
