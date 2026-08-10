"""product_visual Phase 1 gate — image QA + plan (Task 2–3)."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.image_qa_gate import (
    make_await_image_qa_node,
    make_image_qa_check_node,
    make_image_qa_remedy_node,
)
from app.graph.nodes.plan_product_visual import (
    make_plan_product_visual_node,
    resolve_plan_phase,
)
from app.graph.nodes.split_product_visual import make_split_product_visual_node
from app.graph.nodes.scheme_select_gate import (
    make_await_scheme_select_node,
    route_after_await_scheme_select,
)
from app.graph.state import AgentRuntimeState


def route_after_image_qa_check(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    result = state.get("image_qa_result")
    if result in ("pass", "remediated"):
        return "plan_product_visual"
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
        return "plan_product_visual"
    return "end"


def route_after_plan_product_visual(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    plan = state.get("product_visual_plan")
    if not isinstance(plan, dict):
        return "end"
    phase = state.get("phase") or resolve_plan_phase(plan)
    if phase == "await_scheme_select":
        return "await_scheme_select"
    if phase == "split_product_visual":
        return "split_product_visual"
    return "end"


def register_product_visual_gate(
    graph: StateGraph,
    *,
    llm: Any | None = None,
    skills_dir: Any | None = None,
    nest: Any | None = None,
) -> None:
    """Register image QA + plan segment nodes and edges on the main graph."""
    from pathlib import Path

    from app.config import settings

    resolved_skills = Path(skills_dir or settings.skills_dir)

    graph.add_node("image_qa_check", make_image_qa_check_node(nest=nest))
    graph.add_node("await_image_qa", make_await_image_qa_node())
    graph.add_node("image_qa_remedy", make_image_qa_remedy_node(nest=nest))
    graph.add_node(
        "plan_product_visual",
        make_plan_product_visual_node(llm=llm, skills_dir=resolved_skills, nest=nest),
    )
    graph.add_node("await_scheme_select", make_await_scheme_select_node())
    graph.add_node(
        "split_product_visual",
        make_split_product_visual_node(nest=nest, skills_dir=resolved_skills),
    )

    graph.add_conditional_edges(
        "image_qa_check",
        route_after_image_qa_check,
        {
            "plan_product_visual": "plan_product_visual",
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
            "plan_product_visual": "plan_product_visual",
            "done": "done",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "plan_product_visual",
        route_after_plan_product_visual,
        {
            "await_scheme_select": "await_scheme_select",
            "split_product_visual": "split_product_visual",
            "done": "done",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "await_scheme_select",
        route_after_await_scheme_select,
        {
            "plan_product_visual": "plan_product_visual",
            "split_product_visual": "split_product_visual",
            "done": "done",
            "end": END,
        },
    )
    graph.add_edge("split_product_visual", "await_topo")


def build_product_visual_gate_subgraph(
    *,
    llm: Any | None = None,
    skills_dir: Any | None = None,
    nest: Any | None = None,
    checkpointer: Any | None = None,
):
    """Standalone compiled subgraph for isolated pytest."""
    from langgraph.graph import START

    from app.graph.nodes.await_topo import make_await_topo_node
    from app.graph.nodes.done import make_done_node

    graph = StateGraph(AgentRuntimeState)
    graph.add_node("done", make_done_node(nest=nest))
    graph.add_node("await_topo", make_await_topo_node())
    register_product_visual_gate(graph, llm=llm, skills_dir=skills_dir, nest=nest)
    graph.add_edge(START, "image_qa_check")
    graph.add_edge("await_topo", END)
    graph.add_edge("done", END)
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["await_image_qa", "await_scheme_select"],
    )
