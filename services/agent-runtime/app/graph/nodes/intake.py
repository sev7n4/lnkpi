from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.skills.loader import discover_skills

_MARKETING_HINTS = (
    "营销",
    "主图",
    "详情页",
    "banner",
    "campaign",
    "洁具",
    "卫浴",
    "电商",
    "天猫",
    "拆画布",
    "出图",
    "分镜",
)


def marketing_intent(text: str) -> bool:
    """True when the user asks for marketing/campaign canvas orchestration."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    # Require at least one campaign-ish signal; bare product nouns are not enough.
    return any(h in lowered for h in _MARKETING_HINTS)


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
                # Only when intent matched: pick first available skill package
                skill_id = entries[0].skill_id
        # No unique-skill fallback when intent is weak — skill_id stays None → chat

        return {
            "phase": "intake",
            "skill_id": skill_id,
            "awaiting_user": False,
            "user_decision": "none",
            "focus_node_ids": state.get("focus_node_ids") or [],
            "split_manifest": state.get("split_manifest") or [],
            "gen_queue": state.get("gen_queue") or [],
            "gen_completed": state.get("gen_completed") or [],
            "gen_failed": state.get("gen_failed") or [],
            "last_error": state.get("last_error"),
        }

    return intake
