from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

Decision = Literal["none", "confirm", "revise"]

_NONE_DECISION_TIP = "请选择 1/A 确认方案，或 2/B、3/C / 说明修改后再确认。"

_CONFIRM_HINTS = (
    "确认方案",
    "确认",
    "同意",
    "可以",
    "没问题",
    "按这个",
    "开始拆",
    "ok",
    "okay",
    "yes",
    "confirm",
)
_REVISE_HINTS = (
    "改成",
    "修改",
    "调整",
    "换",
    "不要",
    "重新",
    "revise",
    "改一下",
    "更偏",
    "要修改",
    "自己说",
)
_FRESH_BRIEF_HINTS = (
    "请为",
    "写一份",
    "帮我设计",
    "帮我做",
    "帮我写",
)
_CONFIRM_NEGATIONS = (
    "无修改",
    "不修改",
    "不用改",
    "无需修改",
    "没有修改",
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def classify_user_decision(text: str) -> Decision | None:
    """Heuristic classifier. Returns None when ambiguous (caller may use LLM)."""
    raw = text.strip()
    lowered = raw.lower()
    if not lowered:
        return "none"

    token = raw.split()[0].strip().rstrip(".).、）") if raw else ""
    token_u = token.upper()
    if token in ("1",) or token_u in ("A", "Ａ"):
        return "confirm"
    if token in ("2", "3") or token_u in ("B", "C", "Ｂ", "Ｃ"):
        return "revise"

    if any(n in lowered for n in _CONFIRM_NEGATIONS):
        return "confirm"

    if any(h in lowered for h in _REVISE_HINTS):
        return "revise"
    if any(h in lowered for h in _CONFIRM_HINTS):
        if len(lowered) > 24 and any(h in lowered for h in _FRESH_BRIEF_HINTS):
            return None
        return "confirm"

    if any(k in lowered for k in ("营销方案", "帮我设计", "帮我做")):
        return "none"
    return None


async def _llm_classify(llm: Any, text: str) -> Decision:
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
        if decision == "none":
            out["messages"] = [AIMessage(content=_NONE_DECISION_TIP)]
        elif decision == "confirm":
            out["messages"] = [
                AIMessage(content="正在写入确认方案并拆解画布骨架（先不出图），请稍候…")
            ]
        return out
    return await_confirm
