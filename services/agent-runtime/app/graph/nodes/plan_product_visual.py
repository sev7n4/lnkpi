"""Phase 2 product_visual plan LLM node (Task 3)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.nodes.plan._shared import latest_user_text
from app.graph.product_visual_models import (
    parse_product_visual_plan,
    plan_all_types_single_scheme,
    plan_to_state_dict,
    prefill_selected_schemes,
)
from app.graph.product_visual_prompt import (
    build_plan_llm_messages,
    build_plan_user_content,
    load_plan_system_prompt,
)

logger = logging.getLogger(__name__)

PLAN_READY_MSG = "已生成视觉方案，请选择各类型变体后继续。"
PLAN_SILENT_MSG = "已生成视觉方案，各类型仅一套变体，即将拆解画布任务…"


def resolve_plan_phase(plan_dict: dict[str, Any]) -> str:
    """Route: multi-scheme → await_scheme_select; all single → split_product_visual."""
    image_types = plan_dict.get("image_types") or []
    if any(len(t.get("schemes") or []) > 1 for t in image_types if isinstance(t, dict)):
        return "await_scheme_select"
    return "split_product_visual"


def build_plan_result_message(phase: str) -> str:
    if phase == "await_scheme_select":
        return PLAN_READY_MSG
    return PLAN_SILENT_MSG


def make_plan_product_visual_node(
    *,
    llm: Any,
    skills_dir: Path,
    nest: Any | None = None,
) -> Callable:
    async def plan_product_visual(state: dict) -> dict:
        from app.graph.context_snapshot import resolve_brief_for_llm

        system_prompt, prompt_version = load_plan_system_prompt(skills_dir)
        user_brief = await resolve_brief_for_llm(state, nest)
        user_text = latest_user_text(state.get("messages") or [])
        existing_plan = state.get("product_visual_plan")
        revision_feedback = None
        if isinstance(existing_plan, dict) and state.get("scheme_revision_count"):
            revision_feedback = state.get("scheme_revision_feedback") or user_text

        user_content = build_plan_user_content(
            user_brief=user_brief,
            user_text=user_text,
            existing_plan=existing_plan if isinstance(existing_plan, dict) else None,
            revision_feedback=revision_feedback,
        )
        messages = build_plan_llm_messages(
            system_prompt=system_prompt,
            user_content=user_content,
            skills_dir=skills_dir,
        )

        raw = ""
        plan_dict: dict[str, Any] | None = None
        for attempt in range(2):
            try:
                ai = await llm.ainvoke(messages)
                raw = str(getattr(ai, "content", ai) or "")
                plan = parse_product_visual_plan(raw)
                if plan_all_types_single_scheme(plan):
                    plan = prefill_selected_schemes(plan)
                plan_dict = plan_to_state_dict(plan)
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "plan_product_visual parse failed (attempt %s): %s",
                    attempt + 1,
                    exc,
                )

        if plan_dict is None:
            return {
                "phase": "error",
                "last_error": "product_visual_plan_parse_failed",
                "messages": [AIMessage(content="视觉方案生成失败，请重试或补充需求。")],
            }

        phase = resolve_plan_phase(plan_dict)
        return {
            "product_visual_plan": plan_dict,
            "prompt_version": prompt_version,
            "phase": phase,
            "messages": [AIMessage(content=build_plan_result_message(phase))],
        }

    return plan_product_visual
