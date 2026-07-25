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

# 修复 P0-1/P0-2：检测用户在已有方案上的修改意图
_MODIFY_HINTS = (
    "改成",
    "改一下",
    "修改",
    "调整",
    "换成",
    "换成",
    "改为",
    "更偏",
    "强调",
    "增加",
    "加上",
    "删掉",
    "删除",
    "去掉",
    "移除",
    "再改",
    "改一版",
    "自己说明",
    "自己说",
)


def marketing_intent(text: str) -> bool:
    """True when the user asks for marketing/campaign canvas orchestration."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    # Require at least one campaign-ish signal; bare product nouns are not enough.
    return any(h in lowered for h in _MARKETING_HINTS)


def modify_intent(text: str) -> bool:
    """True when the user is modifying an existing plan/skeleton (not a brand-new brief)."""
    lowered = (text or "").strip().lower()
    if not lowered:
        return False
    return any(h in lowered for h in _MODIFY_HINTS)


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

        # 修复 P0-1/P0-2：检测修改模式
        # 如果 state 中已有 user_brief（说明不是首轮）且用户输入带修改意图 → 进入 modify 模式
        existing_brief = state.get("user_brief")
        existing_plan = state.get("plan_draft")
        is_modify = bool(existing_brief and existing_plan and modify_intent(text))

        # 锁定 brief：首轮写入后即锁定，避免后续轮次的主题漂移
        if not state.get("brief_locked") and marketing_intent(text) and not is_modify:
            new_brief = text
            new_locked = True
        elif state.get("brief_locked"):
            new_brief = existing_brief
            new_locked = True
        else:
            new_brief = existing_brief
            new_locked = state.get("brief_locked", False)

        # 决定 mode：modify 模式必须有 brief + plan
        if is_modify:
            mode = "modify"
        elif existing_brief and existing_plan:
            mode = "modify"  # 即使没明显 modify 词，有 brief+plan 也走 modify（避免"3"/"确认"被吞）
        else:
            mode = "create"

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
            # 修复 P0-1/P0-2/P0-3：传递 brief + mode 到后续节点
            "user_brief": new_brief,
            "brief_locked": new_locked,
            "mode": mode,
        }

    return intake
