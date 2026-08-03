from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.atomic_intent import atomic_regenerate_intent, resolve_intake_route
from app.graph.intent import marketing_intent, modify_intent, single_node_gen_intent  # re-export for tests
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
        requested = str(state.get("requested_skill_id") or "").strip()
        by_id = {e.skill_id: e for e in entries}
        skill_id: str | None = None
        flow_mode = "campaign"
        if requested and requested in by_id:
            skill_id = requested
        elif marketing_intent(text):
            preferred = "enterprise-marketing-campaign"
            if preferred in by_id:
                skill_id = preferred
            elif entries:
                skill_id = entries[0].skill_id

        existing_brief = state.get("user_brief")
        existing_plan = state.get("plan_draft")
        focus_node_id = str(state.get("focus_node_id") or "").strip() or None
        route = resolve_intake_route(text, focus_node_id=focus_node_id)
        is_single_node = route == "single_node"
        is_atomic = route == "atomic_create"
        is_modify = bool(
            existing_brief and existing_plan and modify_intent(text) and not is_single_node and not is_atomic
        )

        if is_single_node:
            mode = "create"
            proposed_brief = None
            flow_mode = "single_node"
            if not skill_id and "enterprise-marketing-campaign" in by_id:
                skill_id = "enterprise-marketing-campaign"
        elif (
            atomic_regenerate_intent(text)
            and str(state.get("atomic_node_id") or "").strip()
            and isinstance(state.get("atomic_spec"), dict)
        ):
            mode = "create"
            proposed_brief = None
            flow_mode = "atomic_regenerate"
            skill_id = None
        elif is_atomic:
            mode = "create"
            proposed_brief = None
            flow_mode = "atomic_create"
            skill_id = None
        elif is_modify:
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

        resolved_flow = (
            flow_mode
            if is_single_node or is_atomic or flow_mode == "atomic_regenerate"
            else "campaign"
        )

        out: dict[str, Any] = {
            "phase": "intake",
            "skill_id": skill_id,
            "user_decision": "none",
            "split_manifest": state.get("split_manifest") or [],
            "last_error": state.get("last_error"),
            "mode": mode,
            "flow_mode": resolved_flow,
        }
        if focus_node_id:
            out["focus_node_id"] = focus_node_id
        if proposed_brief is not None:
            out["user_brief"] = proposed_brief
        return out

    return intake
