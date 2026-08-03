"""HITL resume helpers for LangGraph ``interrupt_before`` gates (W5 / P0-05).

LangGraph has two interrupt mechanisms:

1. ``interrupt_before=[...]`` (used by this project): graph pauses *before* the
   gate node runs. Resume by injecting the user message into checkpoint state,
   then continuing with ``ainvoke(None)`` / ``astream(None)``.

2. ``interrupt()`` inside a node: resume with ``Command(resume=...)``.

``Command(resume=...)`` does **not** apply to ``interrupt_before`` — it will not
inject new messages and the gate classifier will not see the user's reply.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage

GATE_DECISION_CLEAR = {"user_decision": "none", "force_choice": None}


def build_interrupt_state_update(
    message: str,
    *,
    user_decision: str | None = None,
) -> dict[str, Any]:
    """State delta to append before resuming an ``interrupt_before`` gate."""
    update: dict[str, Any] = {"messages": [HumanMessage(content=message)]}
    if user_decision:
        update["user_decision"] = user_decision
    return update


async def prepare_interrupt_resume(
    graph: Any,
    config: dict[str, Any],
    message: str,
    *,
    user_decision: str | None = None,
) -> tuple[None, int]:
    """Inject user input and return ``(None, assistant_save_after)`` for streaming.

    Returns graph input ``None`` (continue from interrupt) and the message index
    after which new assistant replies should be persisted.
    """
    snap = await graph.aget_state(config)
    vals = getattr(snap, "values", None) or {}
    assistant_save_after = len(vals.get("messages") or []) + 1
    await graph.aupdate_state(
        config,
        build_interrupt_state_update(message, user_decision=user_decision),
    )
    return None, assistant_save_after


def interrupt_event_payload(
    *,
    next_nodes: list[str],
    phase: str | None,
) -> dict[str, Any]:
    """SSE payload when the graph pauses at an interrupt gate."""
    node = next_nodes[0] if next_nodes else None
    data: dict[str, Any] = {"node": node, "interrupted": True}
    if phase:
        data["phase"] = phase
    return {"type": "interrupt", "data": data}
