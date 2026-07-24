from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

Decision = Literal["none", "confirm", "revise"]

# When user reply is neither confirm nor revise, still surface a visible tip
# (otherwise stream ends with only `done` and the UI looks empty).
_NONE_DECISION_TIP = "请确认方案或说明修改；也可回复「确认」继续拆解画布并出图。"

_CONFIRM_HINTS = (
    "确认",
    "同意",
    "可以",
    "没问题",
    "按这个",
    "开始拆",
    "出图",
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
)
# 「等我确认」出现在长需求里时，应视为新 brief，而非对本轮方案确认
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
    lowered = text.strip().lower()
    if not lowered:
        return "none"

    # 「无修改 / 不修改」是确认，不能因子串「修改」误判为 revise
    if any(n in lowered for n in _CONFIRM_NEGATIONS):
        return "confirm"

    # Prefer revise when both signals appear (e.g. "确认前先改成…")
    if any(h in lowered for h in _REVISE_HINTS):
        return "revise"
    if any(h in lowered for h in _CONFIRM_HINTS):
        # 长需求里的「先等我确认」是未来动作，不是对本轮方案的确认
        if len(lowered) > 24 and any(h in lowered for h in _FRESH_BRIEF_HINTS):
            return None
        return "confirm"

    # Fresh planning requests are not confirmations
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
        # After plan in the same turn, the latest message is the AI confirm prompt —
        # do not re-classify the prior user text (avoids revise→plan→revise loops).
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
            # Immediate tip so SSE stays visibly busy while split/orchestrate_gen runs
            out["messages"] = [
                AIMessage(content="正在按方案拆解画布并出图，请稍候…")
            ]
        return out
    return await_confirm
