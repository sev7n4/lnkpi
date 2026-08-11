"""V2 graph routing helpers (spec §2.1, §4.2)."""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.graph.product_visual_v2.macro_select import should_skip_macro_hitl

# Hard-stop profile per eval scenario (UX-PV-10 gate count tests).
_HARD_STOP_PROFILES: dict[str, dict[str, bool]] = {
    "CVS-02": {
        "image_qa": False,
        "macro": True,
        "shot": True,
        "topo": True,
        "delivery": True,
    },
}


def is_merged_shot_topo_gate_enabled() -> bool:
    return bool(getattr(settings, "pv_merged_shot_topo_gate", False))


def is_fast_mode_gate_enabled() -> bool:
    return bool(getattr(settings, "pv_fast_mode_gate", False))


def shot_confirm_gate_name() -> str:
    return "await_shot_topo_confirm" if is_merged_shot_topo_gate_enabled() else "await_shot_confirm"


def product_visual_v2_interrupt_gates() -> list[str]:
    """HITL interrupt nodes registered by product_visual v2 segment."""
    gates = ["await_macro_scheme_select"]
    gates.append(shot_confirm_gate_name())
    return gates


def count_hard_stops(scenario_id: str, *, merged: bool | None = None) -> int:
    """Count user hard-stops on the default happy path for an eval scenario."""
    profile = _HARD_STOP_PROFILES.get(scenario_id)
    if not profile:
        return 0
    use_merged = is_merged_shot_topo_gate_enabled() if merged is None else merged
    total = 0
    if profile.get("image_qa"):
        total += 1
    if profile.get("macro"):
        total += 1
    if use_merged:
        if profile.get("shot") or profile.get("topo"):
            total += 1
    else:
        if profile.get("shot"):
            total += 1
        if profile.get("topo"):
            total += 1
    if profile.get("delivery"):
        total += 1
    return total


def route_after_orchestrate_shots(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    if state.get("pv_skip_topo_gate") or is_merged_shot_topo_gate_enabled():
        return "start_gen"
    return "await_topo"


def is_v2_enabled(state: dict | None = None) -> bool:
    if isinstance(state, dict) and state.get("product_visual_scheme_v2") is not None:
        return bool(state["product_visual_scheme_v2"])
    return bool(getattr(settings, "product_visual_scheme_v2", False))


def route_after_image_qa_check_v2(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    result = state.get("image_qa_result")
    if result in ("pass", "remediated"):
        if state.get("requires_standard_product_assets"):
            return "phase1_seed_eager"
        return "dialog_draft"
    if result == "fail":
        return "await_image_qa"
    return "end"


def route_after_dialog_draft(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    schemes = state.get("macro_schemes") or []
    if should_skip_macro_hitl(schemes):
        return "canvas_ssot_commit"
    return "await_macro_scheme_select"


def route_after_macro_scheme_select(state: dict) -> str:
    decision = state.get("macro_scheme_decision") or "none"
    if decision == "revise":
        return "dialog_draft"
    if decision in ("confirm", "auto"):
        return "canvas_ssot_commit"
    return "end"
