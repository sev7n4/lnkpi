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
    """Readable confirm gate: positioning + asset list + N + canvas pointer."""
    positioning = _positioning_line(plan_md)
    titles = _manifest_titles(canvas_manifest)
    n = len(titles)
    asset_lines = "\n".join(f"- {t}" for t in titles) if titles else "- （Skill 未声明资产清单）"
    return (
        f"定位：{positioning}\n"
        f"确认后将拆解 {n} 个画布节点并自动出图：\n"
        f"{asset_lines}\n"
        "完整方案已写入画布「营销方案」节点，可在画布查看全文。\n"
        "请确认是否按此方案拆解画布并出图；如需修改请直接说明。"
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
        confirm_msg = build_confirm_message(
            plan_md=plan_md,
            canvas_manifest=skill.canvas_manifest,
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
