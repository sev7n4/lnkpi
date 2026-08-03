"""generate_plan: LLM call to generate or revise the plan markdown.

The sole LLM node in the plan pipeline. Loads the skill body as system prompt,
builds mode-specific human content, invokes LLM, and writes plan_draft + plan_summary.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.nodes.plan._shared import (
    CREATE_INSTRUCTION,
    MODIFY_INSTRUCTION,
    latest_user_text,
    load_skill_by_id,
    strip_plan_preamble,
    summarize,
)


def make_generate_plan_node(*, llm: Any, skills_dir: Path, nest: Any | None = None) -> Callable:
    """Create the generate_plan node."""

    async def generate_plan(state: dict) -> dict:
        skill_id = state.get("skill_id")
        skill = load_skill_by_id(skill_id, skills_dir)

        user_text = latest_user_text(state.get("messages") or [])
        from app.graph.context_snapshot import resolve_brief_for_llm

        user_brief = await resolve_brief_for_llm(state, nest)
        mode = state.get("mode") or "create"
        existing_plan = str(state.get("plan_draft") or "").strip()

        if mode == "modify" and user_brief:
            system_prompt = skill.body
            instruction = MODIFY_INSTRUCTION
            human_bits = [
                f"【首轮用户需求锚定 - 不可偏离】\n{user_brief}",
                f"【已有方案 - 仅修改用户明确要求的部分】\n{existing_plan or '（无）'}",
                f"【本轮用户修改意见】\n{user_text}",
            ]
            human_content = f"{instruction}\n" + "\n\n".join(human_bits)
        else:
            system_prompt = skill.body
            instruction = CREATE_INSTRUCTION
            human_content = f"{instruction}\n用户需求：{user_text}"

        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_content),
        ]
        ai = await llm.ainvoke(messages)
        plan_md = strip_plan_preamble(str(getattr(ai, "content", ai) or ""))
        summary = summarize(plan_md)

        return {
            "plan_draft": plan_md,
            "plan_summary": summary,
        }

    return generate_plan
