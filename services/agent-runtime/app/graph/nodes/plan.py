from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.skills.loader import discover_skills, load_skill


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _summarize(plan_md: str, limit: int = 280) -> str:
    lines = [ln.strip() for ln in plan_md.splitlines() if ln.strip()]
    if not lines:
        return ""
    summary = lines[0].lstrip("# ").strip()
    if len(plan_md) > limit:
        return summary + "…"
    return summary or plan_md[:limit]


def make_plan_node(*, nest: Any, llm: Any, skills_dir: Path) -> Callable:
    async def plan(state: dict) -> dict:
        skill_id = state.get("skill_id")
        if not skill_id:
            raise RuntimeError("skill_id missing; intake must select a skill")

        entries = {e.skill_id: e for e in discover_skills(skills_dir)}
        if skill_id not in entries:
            raise RuntimeError(f"unknown skill_id: {skill_id}")
        skill = load_skill(entries[skill_id])

        user_text = _latest_user_text(state.get("messages") or [])
        messages = [
            SystemMessage(content=skill.body),
            HumanMessage(
                content=(
                    "请根据用户需求输出完整企业营销方案 Markdown（含定位、文案与视觉资产章节）。\n"
                    f"用户需求：{user_text}"
                )
            ),
        ]
        ai = await llm.ainvoke(messages)
        plan_md = str(getattr(ai, "content", ai) or "")

        result = await nest.upsert_prompt_node(
            prompt="营销方案",
            content=plan_md,
            node_id=state.get("plan_node_id"),
        )
        plan_node_id = result["nodeId"]
        summary = _summarize(plan_md)
        confirm_msg = (
            f"已生成方案摘要：{summary}\n"
            "请确认是否按此方案拆解画布并出图；如需修改请直接说明。"
        )

        return {
            "phase": "await_confirm",
            "plan_summary": summary,
            "plan_node_id": plan_node_id,
            "awaiting_user": True,
            "user_decision": "none",
            "messages": [AIMessage(content=confirm_msg)],
        }

    return plan
