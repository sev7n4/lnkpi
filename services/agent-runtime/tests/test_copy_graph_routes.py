"""Graph routing tests for copy write loop."""

from app.graph.subgraphs.copy_gate import route_after_write_copy
from app.graph.subgraphs.topo_gate import route_after_topo


def test_route_after_write_copy_regens_when_blocked():
    assert route_after_write_copy({"copy_write_blocked": True}) == "draft_copy"
    assert route_after_write_copy({"copy_write_blocked": False}) == "await_topo"


def test_route_after_topo_copy_write_goes_to_write_node():
    assert route_after_topo({"user_decision": "copy_write"}) == "write_copy_node"
    assert route_after_topo({"user_decision": "confirm_gen"}) == "start_gen"
