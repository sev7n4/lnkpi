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

import re
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.errors import InvalidUpdateError
from langgraph.types import Command

GATE_DECISION_CLEAR = {"user_decision": "none", "force_choice": None}

REF_MENTION_RE = re.compile(r"@[TIVA]\d+", re.IGNORECASE)

# Cleared when a new user task arrives while a HITL gate is still pending.
FRESH_TURN_STATE_CLEAR: dict[str, Any] = {
    **GATE_DECISION_CLEAR,
    "phase": None,
    "flow_mode": None,
    "mode": None,
    "atomic_spec": None,
    "atomic_items": None,
    "atomic_node_id": None,
    "atomic_record_id": None,
    "clarify_context": None,
    "clarify_question": None,
    "route_clarify": False,
    "pre_parsed_intent": None,
    "route_decision": None,
    "route_context": None,
    "split_manifest": None,
    "last_error": None,
    "product_visual_plan": None,
    "image_qa_result": None,
    "phase1_asset_keys": None,
    "image_qa_decision": None,
    "scheme_revision_count": None,
    "delivery_selections": None,
}


def should_resume_interrupt(
    message: str,
    next_nodes: list[str] | tuple[str, ...],
    *,
    user_decision: str | None = None,
) -> bool:
    """Return True when *message* is a gate reply; False for a fresh task."""
    if not next_nodes:
        return False
    if user_decision and str(user_decision).strip().lower() not in ("", "none"):
        return True

    text = (message or "").strip()
    if not text:
        return False

    gate = str(next_nodes[0])

    from app.graph.atomic_intent import atomic_create_intent, classify_atomic_confirm
    from app.graph.intent import classify_topo_decision, classify_user_decision

    if gate == "await_confirm":
        decision = classify_user_decision(text)
        if decision is not None:
            return True
        # Long @ref task while plan gate is open → restart intake, not confirm/revise.
        if len(text) >= 12 and REF_MENTION_RE.search(text) and atomic_create_intent(text):
            return False
        return len(text) <= 16

    if gate == "await_topo":
        if classify_topo_decision(text) != "none":
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 16

    if gate == "await_copy_confirm":
        lowered = text.lower()
        from app.graph.intent import COPY_CONFIRM_HINTS

        if any(h in text for h in COPY_CONFIRM_HINTS):
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 20

    if gate == "await_atomic_confirm":
        if classify_atomic_confirm(text) != "none":
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 16

    if gate == "await_image_qa":
        from app.graph.nodes.image_qa_gate import classify_image_qa_decision

        if classify_image_qa_decision(text) != "none":
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 20

    if gate == "await_scheme_select":
        from app.graph.nodes.scheme_select_gate import classify_scheme_decision

        decision = classify_scheme_decision(text, user_decision=user_decision)
        if decision.get("action") != "none":
            return True
        if text.startswith("__scheme_decision__"):
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 24

    if gate == "await_delivery_confirm":
        from app.graph.nodes.delivery_summary import classify_delivery_decision

        decision = classify_delivery_decision(text, user_decision=user_decision)
        if decision.get("action") != "none":
            return True
        if text.startswith("__delivery_decision__"):
            return True
        if len(text) >= 12 and REF_MENTION_RE.search(text):
            return False
        return len(text) <= 24

    # Unknown gate: only resume short gate-like replies.
    return len(text) <= 16 and not REF_MENTION_RE.search(text)


def build_fresh_turn_command(*, update: dict[str, Any]) -> Command:
    """Jump back to intake with cleared gate / atomic checkpoint fields."""
    return Command(goto="intake", update={**FRESH_TURN_STATE_CLEAR, **update})


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


# interrupt_before gate → last completed node for ambiguous checkpoint updates.
GATE_RESUME_AS_NODE: dict[str, str] = {
    "await_atomic_confirm": "create_atomic_node",
}


async def prepare_interrupt_resume(
    graph: Any,
    config: dict[str, Any],
    message: str,
    *,
    user_decision: str | None = None,
    as_node: str | None = None,
) -> tuple[None, int]:
    """Inject user input and return ``(None, assistant_save_after)`` for streaming.

    Returns graph input ``None`` (continue from interrupt) and the message index
    after which new assistant replies should be persisted.

    Some gates (e.g. ``await_atomic_confirm``) need ``as_node`` set to the upstream
    node so LangGraph applies the update and actually runs the gate on ``ainvoke(None)``.
    """
    snap = await graph.aget_state(config)
    vals = getattr(snap, "values", None) or {}
    next_nodes = [str(n) for n in (getattr(snap, "next", None) or ())]
    gate_node = next_nodes[0] if next_nodes else None
    resume_as_node = as_node or (GATE_RESUME_AS_NODE.get(gate_node or "") if gate_node else None)
    assistant_save_after = len(vals.get("messages") or []) + 1
    update = build_interrupt_state_update(message, user_decision=user_decision)
    update_kwargs: dict[str, Any] = {}
    if resume_as_node:
        update_kwargs["as_node"] = resume_as_node
    try:
        await graph.aupdate_state(config, update, **update_kwargs)
    except InvalidUpdateError:
        if resume_as_node:
            raise
        await graph.aupdate_state(config, update)
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
