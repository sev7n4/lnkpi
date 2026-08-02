"""Graph builder routing unit tests."""

from __future__ import annotations

from app.graph.builder import route_after_split


def test_route_after_split_modify_returns_await_topo():
    assert route_after_split({"mode": "modify"}) == "await_topo"


def test_route_after_split_create_returns_draft_copy():
    assert route_after_split({"mode": "create"}) == "draft_copy"
