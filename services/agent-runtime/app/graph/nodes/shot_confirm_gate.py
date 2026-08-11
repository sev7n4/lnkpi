"""Phase 3 shot confirm gate — merged with topo entry (v1.1)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.intent import classify_topo_decision


def route_after_await_shot_confirm(state: dict) -> str:
    phase = state.get("phase")
    if phase == "error":
        return "done"
    if phase == "orchestrate_shots":
        return "orchestrate_shots"
    if phase == "decompose_from_ssot":
        return "decompose_from_ssot"
    return "end"


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _last_role(messages: list[Any]) -> str | None:
    if not messages:
        return None
    last = messages[-1]
    return getattr(last, "type", None) or (last.get("role") if isinstance(last, dict) else None)


def make_await_shot_confirm_node() -> Callable:
    async def await_shot_confirm(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {"phase": "await_shot_confirm"}

        text = _latest_user_text(state.get("messages") or [])
        ud = state.get("user_decision")
        if ud in ("confirm", "confirm_gen"):
            decision = "confirm_gen"
        else:
            decision = classify_topo_decision(text)

        if decision == "confirm_gen":
            return {
                "phase": "orchestrate_shots",
                "user_decision": "none",
                "messages": [AIMessage(content="正在编排出图拓扑…")],
            }
        if decision == "revise" or any(k in text for k in ("调整构图", "去掉", "删减")):
            return {
                "phase": "decompose_from_ssot",
                "user_decision": "none",
                "messages": [AIMessage(content="好的，正在重新拆解构图…")],
            }

        shots = state.get("shot_manifest") or []
        lines = ["请确认构图清单："]
        for s in shots:
            if isinstance(s, dict):
                lines.append(
                    f"- {s.get('label') or s.get('shot_id')} "
                    f"({s.get('type_id')}, 方案{s.get('macro_scheme_id', '-')})"
                )
        lines.append("\n确认后回复「确认出图」。")
        return {"phase": "await_shot_confirm", "messages": [AIMessage(content="\n".join(lines))]}

    return await_shot_confirm
