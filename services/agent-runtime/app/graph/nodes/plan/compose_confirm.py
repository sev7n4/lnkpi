"""compose_confirm: build confirm message and set phase.

Pure-function node (no LLM, no side effects). Reads is_node_revise and
decides whether the plan pipeline exits to write_plan_node (node_revise
skip confirm gate) or await_confirm (user must confirm before canvas write).
This is the single source of truth for route_after_plan — it sets ``phase``
and the router just reads it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.nodes.plan._shared import (
    build_confirm_message,
    load_skill_by_id,
    summarize,
)


def make_compose_confirm_node(*, skills_dir: Path) -> Callable:
    """Create the compose_confirm node."""

    async def compose_confirm(state: dict) -> dict:
        is_node_revise = state.get("is_node_revise")
        plan_draft = str(state.get("plan_draft") or "")
        plan_summary = str(state.get("plan_summary") or "")
        node_operations = state.get("node_operations")
        mode = state.get("mode") or "create"
        skill_id = state.get("skill_id")

        if is_node_revise:
            # node_revise: skip await_confirm, go directly to write_plan_node
            n_ops = len(node_operations) if node_operations else 0
            modify_ack = (
                "已按您的修改意见更新方案与画布节点：\n"
                f"- 方案摘要：{plan_summary}\n"
                + (
                    f"- 节点操作：{n_ops} 项（改名/新增/删除）"
                    if node_operations
                    else "- 节点结构沿用原拓扑（未识别到结构变化）"
                )
                + "\n\n已写入画布，请预览拓扑后回复「确认出图」；如需继续调整请说明。"
            )
            return {
                "phase": "write_plan_node",
                "plan_summary": plan_summary,
                "plan_draft": plan_draft,
                "node_operations": node_operations,
                "user_decision": "none",
                "mode": mode,
                "messages": [AIMessage(content=modify_ack)],
            }

        # create or revise (方案门改方向): enter await_confirm gate
        skill = load_skill_by_id(skill_id, skills_dir)
        confirm_msg = build_confirm_message(
            plan_md=plan_draft,
            canvas_manifest=skill.canvas_manifest,
        )
        return {
            "phase": "await_confirm",
            "plan_summary": plan_summary,
            "plan_draft": plan_draft,
            "node_operations": None,
            "user_decision": "none",
            "mode": mode,
            "messages": [AIMessage(content=confirm_msg)],
        }

    return compose_confirm
