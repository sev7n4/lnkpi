"""Plan pipeline: decide_plan_mode → generate_plan → revise_manifest → compose_confirm.

W10 (G-P3) refactored from the monolithic ``plan.py`` node into 4 single-responsibility
nodes. This package provides ``register_plan_nodes`` to wire them into the main graph
and ``route_after_plan`` for the conditional edge from compose_confirm.

The old ``plan.py`` is kept as a deprecated stub that re-exports ``build_confirm_message``
for backward compatibility (``tests/test_plan_summary.py`` still imports from it).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.graph import StateGraph

from app.graph.nodes.plan._shared import build_confirm_message  # noqa: F401 re-export
from app.graph.nodes.plan.compose_confirm import make_compose_confirm_node
from app.graph.nodes.plan.decide_mode import make_decide_plan_mode_node
from app.graph.nodes.plan.generate_plan import make_generate_plan_node
from app.graph.nodes.plan.revise_manifest import make_revise_manifest_node
from app.graph.state import AgentRuntimeState


def register_plan_nodes(
    graph: StateGraph,
    *,
    nest: Any,
    llm: Any,
    skills_dir: Path,
) -> None:
    """Register the 4 plan pipeline nodes and their internal edges on *graph*.

    Callers must still add the conditional edge from ``"compose_confirm"`` via
    ``route_after_plan``, and update inbound edges to point to ``"decide_plan_mode"``.
    """
    graph.add_node("decide_plan_mode", make_decide_plan_mode_node(skills_dir=skills_dir))
    graph.add_node("generate_plan", make_generate_plan_node(llm=llm, skills_dir=skills_dir, nest=nest))
    graph.add_node("revise_manifest", make_revise_manifest_node(llm=llm))
    graph.add_node("compose_confirm", make_compose_confirm_node(skills_dir=skills_dir))

    # Linear pipeline (revise_manifest is transparent when not node_revise)
    graph.add_edge("decide_plan_mode", "generate_plan")
    graph.add_edge("generate_plan", "revise_manifest")
    graph.add_edge("revise_manifest", "compose_confirm")


def route_after_plan(state: AgentRuntimeState) -> str:
    """Route from compose_confirm: phase=='write_plan_node' skips confirm gate.

    This replaces the old route_after_plan that duplicated the is_node_revise
    logic. Now compose_confirm sets phase as the single source of truth.
    """
    if state.get("phase") == "write_plan_node":
        return "write_plan_node"
    return "await_confirm"
