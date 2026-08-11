"""Presentation envelope builder for product_visual v2 sidebar UX."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.scheme_draft import normalize_macro_schemes
from app.graph.product_visual_v2.utterance import (
    collect_superseded_style_keywords,
    has_conflicting_style_utterance,
    strip_superseded_style_keywords,
)

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
    """Render ≤120 char demand summary from effective_utterance + visual_intent."""
    effective = str(state.get("effective_utterance") or "").strip()
    intent = state.get("visual_intent") or {}
    primary = str(intent.get("primary_goal") or "").strip()
    superseded = collect_superseded_style_keywords(state)

    recap = primary or effective
    if not recap:
        route = state.get("route_context") or {}
        recap = str(route.get("utterance") or "").strip()

    recap = strip_superseded_style_keywords(recap, superseded)

    output_types = intent.get("output_types_requested") or []
    if output_types and isinstance(output_types, list):
        type_str = "、".join(str(t).strip() for t in output_types[:3] if str(t).strip())
        if type_str and type_str not in recap:
            candidate = f"{recap}：{type_str}" if recap else type_str
            if len(candidate) <= 120:
                recap = candidate

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


def compute_expected_delivery(
    selected_macro_ids: list[str],
    shots: list[dict[str, Any]],
    *,
    allocation_mode: str = "mixed",
    copy: ProductVisualCopy | None = None,
) -> dict[str, Any]:
    """Compute finalize count and A+B allocation note for macro selection UX."""
    selected = [str(s).strip() for s in selected_macro_ids if str(s).strip()]
    k = len(selected)
    scene_count = len([s for s in shots if isinstance(s, dict)]) if isinstance(shots, list) else 0

    if allocation_mode == "full_matrix":
        total_finalize = scene_count * k if scene_count > 0 else 0
    else:
        total_finalize = scene_count

    allocation_note = ""
    if copy and k >= 2:
        p_str = str(total_finalize) if total_finalize > 0 else "若干"
        allocation_note = copy.get("macro.ab_hint_mixed", k=str(k), p=p_str)

    return {
        "scene_count": scene_count,
        "total_finalize": total_finalize,
        "allocation_note": allocation_note,
    }


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
    elif phase == "await_macro_scheme_select":
        from app.graph.product_visual_v2.macro_select import default_macro_selection

        selected = [
            str(s).strip()
            for s in (state.get("selected_macro_scheme_ids") or default_macro_selection(state.get("macro_schemes") or []))
            if str(s).strip()
        ]
        delivery = compute_expected_delivery(
            selected,
            state.get("shot_manifest") or [],
            copy=copy,
        )
        body: dict[str, Any] = {
            "schemes": normalize_macro_schemes(state.get("macro_schemes") or []),
            "max_select": 2,
        }
        if len(selected) >= 2 and delivery["allocation_note"]:
            body["footer_hint"] = delivery["allocation_note"]
            body["expected_delivery_count"] = delivery["total_finalize"]
        if has_conflicting_style_utterance(state):
            note = copy.get("context.latest_utterance_note")
            if note:
                body["callout"] = note
        envelope["body"] = body

    return envelope
