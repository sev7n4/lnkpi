"""Graph builder routing unit tests."""

from __future__ import annotations

from app.graph.builder import route_after_intake, route_after_split
from app.graph.product_visual_v2.routing import (
    count_hard_stops,
    route_after_canvas_ssot_commit,
    route_after_decompose_from_ssot,
    route_after_orchestrate_shots,
    shot_confirm_gate_name,
)


def test_route_after_intake_route_clarify():
    assert (
        route_after_intake({"phase": "clarify", "route_clarify": True, "clarify_question": "q"})
        == "clarify_gate"
    )


def test_route_after_intake_atomic_clarify():
    assert (
        route_after_intake({"phase": "clarify", "clarify_question": "q", "route_clarify": False})
        == "clarify_gate"
    )


def test_route_after_split_modify_returns_await_topo():
    assert route_after_split({"mode": "modify"}) == "await_topo"


def test_route_after_split_create_returns_apply_sidebar_refs():
    assert route_after_split({"mode": "create"}) == "apply_sidebar_refs"


def test_route_after_split_cycle_goes_to_done():
    assert route_after_split({"phase": "error", "last_error": "cycle detected"}) == "done"


def test_shot_confirm_gate_name_default():
    assert shot_confirm_gate_name() == "await_shot_confirm"


def test_shot_confirm_gate_name_merged(monkeypatch):
    monkeypatch.setattr(
        "app.graph.product_visual_v2.routing.settings.pv_merged_shot_topo_gate",
        True,
    )
    assert shot_confirm_gate_name() == "await_shot_topo_confirm"


def test_route_after_orchestrate_shots_default_goes_await_topo():
    assert route_after_orchestrate_shots({}) == "await_topo"


def test_route_after_orchestrate_shots_merged_skips_topo(monkeypatch):
    monkeypatch.setattr(
        "app.graph.product_visual_v2.routing.settings.pv_merged_shot_topo_gate",
        True,
    )
    assert route_after_orchestrate_shots({}) == "start_gen"


def test_route_after_orchestrate_shots_skip_flag():
    assert route_after_orchestrate_shots({"pv_skip_topo_gate": True}) == "start_gen"


def test_v2_gate_count_with_merged_topo():
    assert count_hard_stops("CVS-02", merged=True) == 3


def test_v2_gate_count_without_merged_topo():
    assert count_hard_stops("CVS-02", merged=False) == 4


def test_route_after_canvas_ssot_commit_error_goes_done():
    assert route_after_canvas_ssot_commit({"phase": "error"}) == "done"
    assert route_after_canvas_ssot_commit({"phase": "decompose_from_ssot"}) == "decompose_from_ssot"


def test_route_after_decompose_error_goes_done():
    assert route_after_decompose_from_ssot({"phase": "error"}) == "done"
    gate = shot_confirm_gate_name()
    assert route_after_decompose_from_ssot({"phase": gate}) == gate
