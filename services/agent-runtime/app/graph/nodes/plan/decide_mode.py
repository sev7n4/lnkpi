"""decide_plan_mode: determine create/modify/node_revise mode and set is_node_revise.

Pure decision node (no LLM, no side effects). Reads mode/user_brief/split_manifest
and computes ``is_node_revise`` for downstream nodes and route_after_plan.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.nodes.plan._shared import canvas_has_nodes, load_skill_by_id


def make_decide_plan_mode_node(*, skills_dir: Path) -> Callable:
    """Create the decide_plan_mode node."""

    async def decide_plan_mode(state: dict) -> dict:
        skill_id = state.get("skill_id")
        if not skill_id:
            raise RuntimeError("skill_id missing; intake must select a skill")

        # Validate skill exists (fail fast)
        load_skill_by_id(skill_id, skills_dir)

        mode = state.get("mode") or "create"
        user_brief = str(state.get("user_brief") or "").strip()
        is_node_revise = bool(mode == "modify" and user_brief and canvas_has_nodes(state))

        return {
            "mode": mode,
            "is_node_revise": is_node_revise,
        }

    return decide_plan_mode
