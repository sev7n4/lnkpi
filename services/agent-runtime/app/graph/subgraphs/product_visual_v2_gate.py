"""Register product_visual v2 graph segment (spec 2026-08-11)."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph

from app.graph.nodes.canvas_ssot_commit import make_canvas_ssot_commit_node
from app.graph.nodes.decompose_from_ssot import make_decompose_from_ssot_node
from app.graph.nodes.dialog_draft import make_dialog_draft_node
from app.graph.nodes.macro_scheme_select_gate import (
    make_await_macro_scheme_select_node,
    route_after_await_macro_scheme_select,
)
from app.graph.nodes.orchestrate_shots_v2 import make_orchestrate_shots_v2_node
from app.graph.nodes.shot_confirm_gate import (
    make_await_shot_confirm_node,
    route_after_await_shot_confirm,
)
from app.graph.product_visual_v2.routing import route_after_dialog_draft
from app.graph.state import AgentRuntimeState


def route_after_dialog_draft_node(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    target = route_after_dialog_draft(state)
    if target == "canvas_ssot_commit":
        return "canvas_ssot_commit"
    if target == "await_macro_scheme_select":
        return "await_macro_scheme_select"
    return "end"


def register_product_visual_v2_nodes(
    graph: StateGraph,
    *,
    llm: Any | None = None,
    skills_dir: Any | None = None,
    nest: Any | None = None,
) -> None:
    from pathlib import Path

    from app.config import settings

    resolved_skills = Path(skills_dir or settings.skills_dir)

    graph.add_node("dialog_draft", make_dialog_draft_node(llm=llm, skills_dir=resolved_skills))
    graph.add_node("await_macro_scheme_select", make_await_macro_scheme_select_node())
    graph.add_node("canvas_ssot_commit", make_canvas_ssot_commit_node(nest=nest))
    graph.add_node(
        "decompose_from_ssot",
        make_decompose_from_ssot_node(llm=llm, skills_dir=resolved_skills, nest=nest),
    )
    graph.add_node("await_shot_confirm", make_await_shot_confirm_node())
    graph.add_node(
        "orchestrate_shots",
        make_orchestrate_shots_v2_node(nest=nest, skills_dir=resolved_skills),
    )

    graph.add_conditional_edges(
        "dialog_draft",
        route_after_dialog_draft_node,
        {
            "canvas_ssot_commit": "canvas_ssot_commit",
            "await_macro_scheme_select": "await_macro_scheme_select",
            "done": "done",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "await_macro_scheme_select",
        route_after_await_macro_scheme_select,
        {
            "dialog_draft": "dialog_draft",
            "canvas_ssot_commit": "canvas_ssot_commit",
            "done": "done",
            "end": END,
        },
    )
    graph.add_edge("canvas_ssot_commit", "decompose_from_ssot")
    graph.add_edge("decompose_from_ssot", "await_shot_confirm")
    graph.add_conditional_edges(
        "await_shot_confirm",
        route_after_await_shot_confirm,
        {
            "orchestrate_shots": "orchestrate_shots",
            "decompose_from_ssot": "decompose_from_ssot",
            "done": "done",
            "end": END,
        },
    )
    graph.add_edge("orchestrate_shots", "await_topo")
