from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.skills.loader import discover_skills, load_skill
from app.graph.plan_clean import strip_plan_preamble


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _positioning_line(plan_md: str) -> str:
    lines = [ln.strip() for ln in (plan_md or "").splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        if "定位" in ln.lstrip("# ").strip():
            for nxt in lines[i + 1 : i + 4]:
                cleaned = nxt.lstrip("#>*- ").strip()
                if cleaned and "定位" not in cleaned:
                    return cleaned[:120]
    for ln in lines:
        if not ln.startswith("#"):
            return ln.lstrip("#>*- ").strip()[:120]
    if lines:
        return lines[0].lstrip("# ").strip()[:120]
    return "（见画布方案节点）"


def _manifest_titles(canvas_manifest: dict | None) -> list[str]:
    if not canvas_manifest or not isinstance(canvas_manifest.get("items"), list):
        return []
    titles: list[str] = []
    for raw in canvas_manifest["items"]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or raw.get("key") or "").strip()
        if title:
            titles.append(title)
    return titles


def build_confirm_message(*, plan_md: str, canvas_manifest: dict | None) -> str:
    """Readable confirm gate: summary + structured options (no canvas write yet)."""
    positioning = _positioning_line(plan_md)
    titles = _manifest_titles(canvas_manifest)
    n = len(titles)
    asset_lines = "\n".join(f"- {t}" for t in titles) if titles else "- （Skill 未声明资产清单）"
    return (
        f"定位：{positioning}\n"
        f"拟定拆解约 {n} 个画布节点（确认方案后写入画布，确认出图后再生成）：\n"
        f"{asset_lines}\n"
        "方案全文见上方摘要（确认前不会写入画布节点）。\n\n"
        "请选择：\n"
        "1 / A：采纳推荐并确认方案（推荐：按当前摘要落稿，进入骨架预览）\n"
        "2 / B：换个方向再改一版（例如更偏天猫详情页 / 更强调卖点）\n"
        "3 / C：我自己说明修改\n"
        "也可直接回复编号或具体修改意见。"
    )


def _summarize(plan_md: str, limit: int = 280) -> str:
    return _positioning_line(plan_md)[:limit]


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
                    "请根据用户需求输出完整企业营销方案 Markdown（含定位、文案与视觉资产章节）。"
                    "只输出方案 Markdown 正文，从一级标题开始，禁止寒暄与过程说明。\n"
                    f"用户需求：{user_text}"
                )
            ),
        ]
        ai = await llm.ainvoke(messages)
        plan_md = strip_plan_preamble(str(getattr(ai, "content", ai) or ""))
        summary = _summarize(plan_md)
        confirm_msg = build_confirm_message(
            plan_md=plan_md,
            canvas_manifest=skill.canvas_manifest,
        )

        return {
            "phase": "await_confirm",
            "plan_summary": summary,
            "plan_draft": plan_md,
            # Do not upsert canvas until write_plan_node after confirm
            "awaiting_user": True,
            "user_decision": "none",
            "messages": [AIMessage(content=confirm_msg)],
        }

    return plan
