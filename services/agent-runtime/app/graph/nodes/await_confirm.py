from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.intent import classify_user_decision

_NONE_DECISION_TIP = "请选择 1/A 确认方案，或 2/B、3/C / 说明修改后再确认。"


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
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {
                "user_decision": "none",
                "awaiting_user": True,
                "phase": "await_confirm",
            }

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_user_decision(text)
        if decision is None:
            decision = await _llm_classify(llm, text)

        awaiting = decision == "none"
        out: dict[str, Any] = {
            "user_decision": decision,
            "awaiting_user": awaiting,
            "phase": "await_confirm" if awaiting else state.get("phase") or "await_confirm",
        }
        # 修复 P0-3 盲点：await_confirm → revise → plan 路径不经过 intake，
        # mode 不会被更新为 modify。这里在 revise 时同步设 mode=modify，
        # 让 plan 节点走增量修改分支（保留未提及的节点/文案）。
        if decision == "revise" and state.get("user_brief") and state.get("plan_draft"):
            out["mode"] = "modify"
        elif decision == "none":
            out["messages"] = [AIMessage(content=_NONE_DECISION_TIP)]
        elif decision == "confirm":
            out["messages"] = [
                AIMessage(content="正在写入确认方案并拆解画布骨架（先不出图），请稍候…")
            ]
        return out
    return await_confirm
