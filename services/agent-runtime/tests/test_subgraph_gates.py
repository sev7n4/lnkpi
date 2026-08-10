"""W6: independent subgraph compile smoke tests."""

from __future__ import annotations

from pathlib import Path

from langgraph.graph import END, START, StateGraph

from app.graph.nodes.await_copy_confirm import make_await_copy_confirm_node
from app.graph.nodes.await_topo import make_await_topo_node
from app.graph.nodes.collect_gen import make_collect_gen_node
from app.graph.nodes.draft_copy import make_draft_copy_node
from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from app.graph.state import AgentRuntimeState
from app.graph.builder import build_agent_graph
from app.graph.subgraphs.confirm_gate import build_confirm_gate_subgraph
from app.graph.subgraphs.copy_gate import route_after_copy_confirm, route_after_draft_copy
from app.graph.subgraphs.topo_gate import route_after_topo


class _FakeLLM:
    pass


class _FakeNest:
    pass


SKILLS = Path(__file__).resolve().parents[1] / "skills"


def test_confirm_gate_subgraph_compiles():
    g = build_confirm_gate_subgraph(nest=_FakeNest(), llm=_FakeLLM(), skills_dir=SKILLS)
    assert g is not None


def test_copy_gate_subgraph_compiles():
    graph = StateGraph(AgentRuntimeState)
    graph.add_node("draft_copy", make_draft_copy_node(nest=_FakeNest(), llm=_FakeLLM()))
    graph.add_node("await_copy_confirm", make_await_copy_confirm_node())
    graph.add_node("write_copy_node", make_write_copy_node(nest=_FakeNest()))
    graph.add_edge(START, "draft_copy")
    graph.add_conditional_edges("draft_copy", route_after_draft_copy, {"await_copy_confirm": "await_copy_confirm"})
    graph.add_conditional_edges(
        "await_copy_confirm",
        route_after_copy_confirm,
        {"write_copy_node": "write_copy_node", "draft_copy": "draft_copy", "end": END},
    )
    graph.add_edge("write_copy_node", END)
    assert graph.compile() is not None


def test_topo_gate_subgraph_compiles():
    graph = StateGraph(AgentRuntimeState)
    graph.add_node("await_topo", make_await_topo_node())
    graph.add_node("start_gen", make_start_gen_node())
    graph.add_node("gen_scheduler", make_gen_scheduler_node())
    graph.add_node("gen_node", make_gen_node(nest=_FakeNest()))
    graph.add_node("collect_gen", make_collect_gen_node(nest=_FakeNest()))
    graph.add_edge(START, "await_topo")
    graph.add_conditional_edges(
        "await_topo",
        route_after_topo,
        {"start_gen": "start_gen", "end": END},
    )
    graph.add_edge("start_gen", "gen_scheduler")
    graph.add_edge("gen_node", "gen_scheduler")
    graph.add_edge("collect_gen", END)
    assert graph.compile() is not None


def test_full_agent_graph_with_product_visual_gate_compiles():
    """Full graph compile smoke — product_visual_gate registered on main builder."""
    graph = build_agent_graph(nest=_FakeNest(), llm=_FakeLLM(), skills_dir=SKILLS)
    assert graph is not None
    node_names = set(getattr(graph, "nodes", {}).keys())
    assert "image_qa_check" in node_names
    assert "plan_product_visual" in node_names
    assert "split_product_visual" in node_names
    assert "delivery_summary" in node_names
