"""W6: topo_gate — await_topo → topo_revise / gen Send fan-out → collect_gen (flat graph registration)."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.await_topo import make_await_topo_node
from app.graph.nodes.collect_gen import make_collect_gen_node
from app.graph.nodes.delivery_summary import route_after_collect_gen
from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.nodes.topo_revise import make_topo_revise_node
from app.graph.state import AgentRuntimeState


def route_after_topo(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "copy_write":
        return "write_copy_node"
    if decision == "confirm_gen":
        return "start_gen"
    if decision == "topo_revise":
        return "topo_revise"
    if decision == "node_revise":
        return "decide_plan_mode"
    return "end"


def register_topo_gate(graph: StateGraph, *, nest: Any) -> None:
    graph.add_node("await_topo", make_await_topo_node())
    graph.add_node("topo_revise", make_topo_revise_node(nest=nest))
    graph.add_node("start_gen", make_start_gen_node(nest=nest))
    graph.add_node("gen_scheduler", make_gen_scheduler_node())
    graph.add_node("gen_node", make_gen_node(nest=nest))
    graph.add_node("collect_gen", make_collect_gen_node(nest=nest))

    graph.add_conditional_edges(
        "await_topo",
        route_after_topo,
        {
            "start_gen": "start_gen",
            "topo_revise": "topo_revise",
            "write_copy_node": "write_copy_node",
            "decide_plan_mode": "decide_plan_mode",
            "end": END,
        },
    )
    graph.add_edge("topo_revise", "await_topo")
    graph.add_edge("start_gen", "gen_scheduler")
    graph.add_edge("gen_node", "gen_scheduler")
    graph.add_conditional_edges(
        "collect_gen",
        route_after_collect_gen,
        {
            "delivery_summary": "delivery_summary",
            "done": "done",
        },
    )


def build_topo_gate_subgraph(*, nest: Any, checkpointer: Any | None = None):
    from langgraph.graph import START

    graph = StateGraph(AgentRuntimeState)
    register_topo_gate(graph, nest=nest)
    graph.add_edge(START, "await_topo")
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_topo"],
    )
