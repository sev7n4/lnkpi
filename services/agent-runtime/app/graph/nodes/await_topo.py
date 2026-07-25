from __future__ import annotations

from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

Decision = Literal["none", "confirm_gen", "topo_revise"]

_NONE_TIP = "请确认出图，或说明如何调整拓扑（例如「删掉 Banner」）；主文案可用「写入主文案」。"

_CONFIRM_GEN_HINTS = (
    "确认出图",
    "开始出图",
    "出图吧",
    "可以出图",
    "生成图片",
    "开始生成",
)
_TOPO_REVISE_HINTS = (
    "要改拓扑",
    "改拓扑",
    "删掉",
    "删除",
    "去掉",
    "增加",
    "加上",
    "不要",
    "依赖",
    "连到",
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def classify_topo_decision(text: str) -> Decision:
    t = text.strip()
    if not t:
        return "none"
    lowered = t.lower()
    if any(h in t or h in lowered for h in _CONFIRM_GEN_HINTS):
        return "confirm_gen"
    if any(h in t for h in _TOPO_REVISE_HINTS):
        return "topo_revise"
    if t in ("确认", "1", "A", "a") or t.lower() == "ok":
        return "confirm_gen"
    return "none"


def make_await_topo_node() -> Callable:
    async def await_topo(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        decision = classify_topo_decision(text)
        if decision == "none":
            return {
                "user_decision": "none",
                "awaiting_user": True,
                "phase": "await_topo",
                "messages": [AIMessage(content=_NONE_TIP)],
            }
        if decision == "topo_revise":
            return {
                "user_decision": "topo_revise",
                "awaiting_user": True,
                "phase": "await_topo",
            }
        return {
            "user_decision": "confirm_gen",
            "awaiting_user": False,
            "phase": "await_topo",
            "pending_orchestrate": False,
            "messages": [AIMessage(content="开始按拓扑出图，请稍候…")],
        }

    return await_topo
