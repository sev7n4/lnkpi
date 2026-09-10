"""C2: cancelling an idle thread must not strand a pending interrupt_before gate."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph
from app.graph.hitl_resume import cancel_state_clear_for_resume
from app.graph.product_visual_v2.routing import shot_confirm_gate_name
from app.run_cancel import clear_cancel, is_cancel_requested
from app.runs import CancelRunRequest, cancel_run, get_thread_state, resolve_turn_input

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


class _Nest:
    def __init__(self) -> None:
        self.cancelled_node_ids: list[str] = []
        self._db_locks: set[str] = set()

    async def close(self) -> None:
        pass

    async def acquire_thread_lock(
        self, thread_id: str, holder_id: str, ttl_seconds: float = 300
    ) -> dict[str, bool]:
        if thread_id in self._db_locks:
            return {"acquired": False}
        self._db_locks.add(thread_id)
        return {"acquired": True}

    async def renew_thread_lock(
        self, thread_id: str, holder_id: str, ttl_seconds: float = 300
    ) -> dict[str, bool]:
        return {"renewed": True}

    async def release_thread_lock(self, thread_id: str, holder_id: str) -> dict[str, bool]:
        self._db_locks.discard(thread_id)
        return {"released": True}

    async def cancel_generation(self, *, node_id: str) -> dict[str, Any]:
        self.cancelled_node_ids.append(node_id)
        return {"ok": True}


def _graph(cp: MemorySaver):
    return build_agent_graph(nest=_Nest(), llm=None, skills_dir=SKILLS_DIR, checkpointer=cp)


async def _pause_at_shot_gate(cp: MemorySaver, thread_id: str) -> list[str]:
    """Seed a checkpoint paused before the shot-confirm gate."""
    graph = _graph(cp)
    config = {"configurable": {"thread_id": thread_id}}
    await graph.aupdate_state(
        config,
        {
            "messages": [HumanMessage(content="帮我出图")],
            "thread_id": thread_id,
            "session_id": "s1",
            "user_id": "u1",
            "flow_mode": "product_visual",
            "phase": shot_confirm_gate_name(),
            "selected_macro_scheme_ids": ["m1"],
            "shot_manifest": [{"shot_id": "s1"}],
        },
        as_node="decompose_from_ssot",
    )
    snap = await graph.aget_state(config)
    return [str(node) for node in (snap.next or ())]


@pytest.mark.asyncio
async def test_cancel_run_preserves_pending_gate_next_nodes():
    cp = MemorySaver()
    tid = "thread-cancel-gate-pending"
    clear_cancel(tid)
    gate_before = await _pause_at_shot_gate(cp, tid)
    assert gate_before == [shot_confirm_gate_name()]

    try:
        result = await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=_Nest(),
        )

        assert result["ok"] is True
        assert result["gate_preserved"] is True
        assert result["next_nodes"] == gate_before
        assert result["phase"] == shot_confirm_gate_name()
        assert is_cancel_requested(tid) is False

        state = await get_thread_state(tid, checkpointer=cp)
        assert state["nextNodes"] == gate_before
        assert state["interrupted"] is True
        assert state["phase"] == shot_confirm_gate_name()
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_gate_resume_still_classifies_after_cancel():
    """UAT-INT-PV-05: 「确认出图」 must still resume the gate after a stop."""
    cp = MemorySaver()
    tid = "thread-cancel-gate-resume"
    clear_cancel(tid)
    gate_before = await _pause_at_shot_gate(cp, tid)

    try:
        await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=_Nest(),
        )
        snap = await _graph(cp).aget_state({"configurable": {"thread_id": tid}})
        next_nodes = [str(node) for node in (snap.next or ())]
        assert next_nodes == gate_before

        deferred = resolve_turn_input(
            {**snap.values, "run_cancelled": True},
            next_nodes,
            "确认出图",
            None,
            {"messages": [HumanMessage(content="确认出图")], "session_id": "s1"},
        )
        assert deferred is None  # deferred to the async gate-resume path
    finally:
        clear_cancel(tid)


def test_cancel_state_clear_for_resume_restores_origin_phase():
    """I3: gate resume clears cancel bookkeeping and restores the pre-cancel phase."""
    assert cancel_state_clear_for_resume({"phase": "await_shot_topo_confirm"}) == {}

    cleared = cancel_state_clear_for_resume(
        {
            "phase": "cancelled",
            "run_cancelled": True,
            "cancel_reason": "user",
            "cancelled_from_phase": "orchestrate_gen",
        }
    )
    assert cleared == {
        "run_cancelled": None,
        "cancel_reason": None,
        "cancelled_from_phase": None,
        "phase": "orchestrate_gen",
    }

    assert cancel_state_clear_for_resume({"run_cancelled": True})["phase"] is None
