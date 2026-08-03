"""P4: atomic_create_gate — parse → create node → confirm? → generate → done."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.atomic_create_node import make_create_atomic_node
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node
from app.graph.nodes.await_atomic_confirm import make_await_atomic_confirm_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node
from app.graph.state import AgentRuntimeState


def route_after_atomic_create(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    spec = state.get("atomic_spec") or {}
    if spec.get("confirm_gate"):
        return "await_atomic_confirm"
    return "run_atomic_gen"


def route_after_atomic_confirm(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm":
        return "run_atomic_gen"
    if decision == "revise":
        return "done"
    return "end"


def register_atomic_create_gate(graph: StateGraph, *, nest: Any) -> None:
    graph.add_node("parse_atomic_intent", make_parse_atomic_intent_node())
    graph.add_node("create_atomic_node", make_create_atomic_node(nest=nest))
    graph.add_node("await_atomic_confirm", make_await_atomic_confirm_node())
    graph.add_node("run_atomic_gen", make_run_atomic_gen_node(nest=nest))

    graph.add_conditional_edges(
        "parse_atomic_intent",
        lambda s: "done" if s.get("phase") == "error" else "create_atomic_node",
        {"create_atomic_node": "create_atomic_node", "done": "done"},
    )
    graph.add_conditional_edges(
        "create_atomic_node",
        route_after_atomic_create,
        {
            "await_atomic_confirm": "await_atomic_confirm",
            "run_atomic_gen": "run_atomic_gen",
            "done": "done",
        },
    )
    graph.add_conditional_edges(
        "await_atomic_confirm",
        route_after_atomic_confirm,
        {
            "run_atomic_gen": "run_atomic_gen",
            "done": "done",
            "end": END,
        },
    )
    graph.add_edge("run_atomic_gen", "done")
