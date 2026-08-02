"""W6: confirm_gate — plan pipeline + await_confirm + write_plan_node (flat graph registration)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.await_confirm import make_await_confirm_node
from app.graph.nodes.plan import register_plan_nodes, route_after_plan
from app.graph.nodes.write_plan_node import make_write_plan_node
from app.graph.state import AgentRuntimeState


def route_after_confirm(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm":
        return "write_plan_node"
    if decision == "revise":
        return "decide_plan_mode"
    return "end"


def register_confirm_gate(graph: StateGraph, *, nest: Any, llm: Any, skills_dir: Path) -> None:
    """Register plan + confirm gate nodes and internal edges on the main graph."""
    register_plan_nodes(graph, nest=nest, llm=llm, skills_dir=skills_dir)
    graph.add_node("await_confirm", make_await_confirm_node(llm=llm))
    graph.add_node("write_plan_node", make_write_plan_node(nest=nest))

    graph.add_conditional_edges(
        "compose_confirm",
        route_after_plan,
        {"write_plan_node": "write_plan_node", "await_confirm": "await_confirm"},
    )
    graph.add_conditional_edges(
        "await_confirm",
        route_after_confirm,
        {"write_plan_node": "write_plan_node", "decide_plan_mode": "decide_plan_mode", "end": END},
    )


def build_confirm_gate_subgraph(*, nest: Any, llm: Any, skills_dir: Path, checkpointer: Any | None = None):
    """Standalone compiled subgraph for isolated pytest (W6 acceptance)."""
    from langgraph.graph import START

    graph = StateGraph(AgentRuntimeState)
    register_confirm_gate(graph, nest=nest, llm=llm, skills_dir=skills_dir)
    graph.add_edge(START, "decide_plan_mode")
    graph.add_edge("write_plan_node", END)
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_confirm"],
    )
