"""product_visual Phase 1 gate — image QA + plan stub (Task 2)."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.image_qa_gate import (
    make_await_image_qa_node,
    make_image_qa_check_node,
    make_image_qa_remedy_node,
    make_plan_product_visual_stub_node,
)
from app.graph.state import AgentRuntimeState


def route_after_image_qa_check(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    result = state.get("image_qa_result")
    if result in ("pass", "remediated"):
        return "plan_product_visual_stub"
    if result == "fail":
        return "await_image_qa"
    return "end"


def route_after_await_image_qa(state: AgentRuntimeState) -> str:
    decision = state.get("image_qa_decision") or "none"
    if decision == "none":
        return "end"
    return "image_qa_remedy"


def route_after_image_qa_remedy(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    if state.get("image_qa_decision") == "ai_white_bg":
        return "plan_product_visual_stub"
    return "end"


def register_product_visual_gate(graph: StateGraph, *, nest: Any | None = None) -> None:
    """Register image QA segment nodes and edges on the main graph."""
    graph.add_node("image_qa_check", make_image_qa_check_node(nest=nest))
    graph.add_node("await_image_qa", make_await_image_qa_node())
    graph.add_node("image_qa_remedy", make_image_qa_remedy_node(nest=nest))
    graph.add_node("plan_product_visual_stub", make_plan_product_visual_stub_node())

    graph.add_conditional_edges(
        "image_qa_check",
        route_after_image_qa_check,
        {
            "plan_product_visual_stub": "plan_product_visual_stub",
            "await_image_qa": "await_image_qa",
            "done": "done",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "await_image_qa",
        route_after_await_image_qa,
        {
            "image_qa_remedy": "image_qa_remedy",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "image_qa_remedy",
        route_after_image_qa_remedy,
        {
            "plan_product_visual_stub": "plan_product_visual_stub",
            "done": "done",
            "end": END,
        },
    )
    graph.add_edge("plan_product_visual_stub", END)


def build_product_visual_gate_subgraph(*, nest: Any | None = None, checkpointer: Any | None = None):
    """Standalone compiled subgraph for isolated pytest."""
    from langgraph.graph import START

    from app.graph.nodes.done import make_done_node

    graph = StateGraph(AgentRuntimeState)
    graph.add_node("done", make_done_node(nest=nest))
    register_product_visual_gate(graph, nest=nest)
    graph.add_edge(START, "image_qa_check")
    graph.add_edge("done", END)
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_image_qa"],
    )
