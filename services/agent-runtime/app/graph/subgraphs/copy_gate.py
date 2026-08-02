"""W6: copy_gate — draft_copy → await_copy_confirm → write_copy_node (flat graph registration)."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.await_copy_confirm import make_await_copy_confirm_node
from app.graph.nodes.draft_copy import make_draft_copy_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from app.graph.state import AgentRuntimeState


def route_after_draft_copy(state: AgentRuntimeState) -> str:
    return "await_copy_confirm"


def route_after_copy_confirm(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm":
        return "write_copy_node"
    if decision == "revise":
        return "draft_copy"
    return "end"


def route_after_write_copy(state: AgentRuntimeState) -> str:
    if state.get("copy_write_blocked"):
        return "draft_copy"
    return "await_topo"


def register_copy_gate(graph: StateGraph, *, nest: Any, llm: Any) -> None:
    graph.add_node("draft_copy", make_draft_copy_node(nest=nest, llm=llm))
    graph.add_node("await_copy_confirm", make_await_copy_confirm_node())
    graph.add_node("write_copy_node", make_write_copy_node(nest=nest))

    graph.add_conditional_edges(
        "draft_copy",
        route_after_draft_copy,
        {"await_copy_confirm": "await_copy_confirm"},
    )
    graph.add_conditional_edges(
        "await_copy_confirm",
        route_after_copy_confirm,
        {
            "write_copy_node": "write_copy_node",
            "draft_copy": "draft_copy",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "write_copy_node",
        route_after_write_copy,
        {"draft_copy": "draft_copy", "await_topo": "await_topo"},
    )


def build_copy_gate_subgraph(*, nest: Any, llm: Any, checkpointer: Any | None = None):
    from langgraph.graph import START

    graph = StateGraph(AgentRuntimeState)
    register_copy_gate(graph, nest=nest, llm=llm)
    graph.add_edge(START, "draft_copy")
    graph.add_edge("write_copy_node", END)
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_copy_confirm"],
    )
