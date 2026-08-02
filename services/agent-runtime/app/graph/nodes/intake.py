from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.intent import marketing_intent, modify_intent  # re-export for tests
from app.graph.state import BRIEF_RESET_PREFIX
from app.skills.loader import discover_skills


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_intake_node(skills_dir: Path) -> Callable:
    async def intake(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        entries = discover_skills(skills_dir)
        skill_id: str | None = None
        if marketing_intent(text):
            preferred = "enterprise-marketing-campaign"
            by_id = {e.skill_id: e for e in entries}
            if preferred in by_id:
                skill_id = preferred
            elif entries:
                skill_id = entries[0].skill_id

        existing_brief = state.get("user_brief")
        existing_plan = state.get("plan_draft")
        is_modify = bool(existing_brief and existing_plan and modify_intent(text))

        if is_modify:
            mode = "modify"
            proposed_brief = None  # reducer keeps existing brief
        elif marketing_intent(text):
            mode = "create"
            if existing_brief and not modify_intent(text):
                proposed_brief = BRIEF_RESET_PREFIX + text
            else:
                proposed_brief = text
        else:
            mode = "create"
            proposed_brief = None

        out: dict[str, Any] = {
            "phase": "intake",
            "skill_id": skill_id,
            "user_decision": "none",
            "focus_node_ids": state.get("focus_node_ids") or [],
            "split_manifest": state.get("split_manifest") or [],
            "gen_completed": state.get("gen_completed") or [],
            "gen_failed": state.get("gen_failed") or [],
            "last_error": state.get("last_error"),
            "mode": mode,
        }
        if proposed_brief is not None:
            out["user_brief"] = proposed_brief
        return out

    return intake
