"""Graph builder routing unit tests."""

from __future__ import annotations

from app.graph.builder import route_after_intake, route_after_split


def test_route_after_intake_route_clarify():
    assert (
        route_after_intake({"phase": "clarify", "route_clarify": True, "clarify_question": "q"})
        == "clarify_route"
    )


def test_route_after_intake_atomic_clarify():
    assert (
        route_after_intake({"phase": "clarify", "clarify_question": "q", "route_clarify": False})
        == "clarify_atomic_intent"
    )


def test_route_after_split_modify_returns_await_topo():
    assert route_after_split({"mode": "modify"}) == "await_topo"


def test_route_after_split_create_returns_apply_sidebar_refs():
    assert route_after_split({"mode": "create"}) == "apply_sidebar_refs"


def test_route_after_split_cycle_goes_to_done():
    assert route_after_split({"phase": "error", "last_error": "cycle detected"}) == "done"
