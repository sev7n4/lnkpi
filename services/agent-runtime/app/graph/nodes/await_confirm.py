from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.intent import classify_user_decision
from app.graph.limits import MAX_PLAN_REVISE

_NONE_DECISION_TIP = "请选择 1/A 确认方案，或 2/B、3/C / 说明修改后再确认。"
_MAX_PLAN_REVISE_TIP = (
    f"已达最大修订次数（{MAX_PLAN_REVISE} 次），请确认当前方案（回复 1/确认），"
    "或放弃本轮后重新描述需求。"
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


async def _llm_classify(llm: Any, text: str) -> str:
    ai = await llm.ainvoke(
        [
            SystemMessage(
                content=(
                    "Classify the user's reply about a marketing plan. "
                    "Reply with exactly one token: confirm | revise | none"
                )
            ),
            HumanMessage(content=text),
        ]
    )
    raw = str(getattr(ai, "content", ai) or "").strip().lower()
    if "confirm" in raw or "确认" in raw:
        return "confirm"
    if "revise" in raw or "修改" in raw or "改" in raw:
        return "revise"
    return "none"


def _last_role(messages: list[Any]) -> str | None:
    if not messages:
        return None
    last = messages[-1]
    return getattr(last, "type", None) or (last.get("role") if isinstance(last, dict) else None)


def make_await_confirm_node(*, llm: Any) -> Callable:
    async def await_confirm(state: dict) -> dict:
        # W5: interrupt_before 替代 awaiting_user flag
        # 从 checkpoint 恢复时，state 已包含用户新消息
        # 如果最后一条消息不是用户消息，说明用户还没回复，不返回提示
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {
                "user_decision": "none",
                "phase": "await_confirm",
            }

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_user_decision(text)
        if decision is None:
            decision = await _llm_classify(llm, text)

        out: dict[str, Any] = {
            "user_decision": decision,
            "phase": "await_confirm",
        }
        # 修复 P0-3 盲点：await_confirm → revise → plan 路径不经过 intake，
        # mode 不会被更新为 modify。这里在 revise 时同步设 mode=modify，
        # 让 plan 节点走增量修改分支（保留未提及的节点/文案）。
        if decision == "revise":
            revise_count = int(state.get("plan_revise_count") or 0)
            if revise_count >= MAX_PLAN_REVISE:
                return {
                    "user_decision": "none",
                    "phase": "await_confirm",
                    "force_choice": "plan_max_revise",
                    "messages": [AIMessage(content=_MAX_PLAN_REVISE_TIP)],
                }
            out["plan_revise_count"] = revise_count + 1
            if state.get("user_brief") and state.get("plan_draft"):
                out["mode"] = "modify"
        elif decision == "none":
            out["messages"] = [AIMessage(content=_NONE_DECISION_TIP)]
        elif decision == "confirm":
            out["plan_revise_count"] = 0
            out["force_choice"] = None
            out["messages"] = [
                AIMessage(content="正在写入确认方案并拆解画布骨架（先不出图），请稍候…")
            ]
        return out
    return await_confirm
