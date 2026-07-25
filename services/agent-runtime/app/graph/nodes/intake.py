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
# 注意：需与 apps/web/src/components/agent/agentChipSet.ts 的 _MODIFY_INTENT_KEYWORDS 保持同步
_MODIFY_HINTS = (
    "改成",
    "改一下",
    "修改",
    "调整",
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
    "改拓扑",
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
        # 但用户明确要全新方案（mode=create + marketing_intent）时解锁并重置 brief
        if is_modify:
            # modify 模式：保留旧 brief 作为锚定
            new_brief = existing_brief
            new_locked = state.get("brief_locked", False)
        elif marketing_intent(text):
            # 用户新需求（含明确营销意图）→ 写入/覆盖 brief 并锁定
            new_brief = text
            new_locked = True
        else:
            # 非营销意图（闲聊/确认词）→ 保留现有 brief 状态
            new_brief = existing_brief
            new_locked = state.get("brief_locked", False)

        # 决定 mode：modify 模式必须有 brief + plan + 显式 modify 意图
        # 注意：existing_brief+plan 存在但用户无 modify 意图时，走 create 模式
        # （例如用户在 done 后说"帮我做运动鞋详情页"应生成全新方案，而非锚定到旧主题）
        if is_modify:
            mode = "modify"
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
