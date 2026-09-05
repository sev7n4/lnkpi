from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.config import settings
from app.graph.builder import build_agent_graph
from app.main import app, clear_run_overrides, configure_run_overrides
from app.run_cancel import clear_cancel, is_cancel_requested
from app.runs import CancelRunRequest, cancel_run


class _Nest:
    def __init__(self) -> None:
        self.cancelled_node_ids: list[str] = []

    async def close(self) -> None:
        pass

    async def cancel_generation(self, *, node_id: str) -> dict[str, Any]:
        self.cancelled_node_ids.append(node_id)
        return {"ok": True}


async def _seed_checkpoint(cp: MemorySaver, thread_id: str, values: dict[str, Any]) -> None:
    graph = build_agent_graph(
        nest=_Nest(),
        llm=None,
        skills_dir=Path(__file__).resolve().parents[1] / "skills",
        checkpointer=cp,
    )
    await graph.aupdate_state(
        {"configurable": {"thread_id": thread_id}},
        {"thread_id": thread_id, "session_id": "s1", "user_id": "u1", **values},
    )


@pytest.mark.asyncio
async def test_cancel_run_sets_flag_and_is_idempotent(monkeypatch):
    clear_run_overrides()
    cp = MemorySaver()
    configure_run_overrides(checkpointer=cp)
    tid = "thread-cancel-api-1"
    clear_cancel(tid)
    monkeypatch.setattr(
        type(settings),
        "effective_runtime_auth_token",
        property(lambda _self: "test-token"),
    )

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            headers = {"x-lnkpi-service-token": "test-token"}
            r1 = await client.post(
                "/v1/runs/cancel",
                json={"thread_id": tid, "session_id": "s1", "reason": "user"},
                headers=headers,
            )
            r2 = await client.post(
                "/v1/runs/cancel",
                json={"thread_id": tid, "session_id": "s1", "reason": "user"},
                headers=headers,
            )

        assert r1.status_code == 200
        assert r1.json() == {
            "ok": True,
            "phase": None,
            "cancelled_node_ids": [],
            "completed_tasks": 0,
            "total_tasks": 0,
            "skipped": True,
            "reason": "flow_not_supported",
        }
        assert r2.json()["ok"] is True
        assert is_cancel_requested(tid) is True
    finally:
        clear_cancel(tid)
        clear_run_overrides()


@pytest.mark.asyncio
async def test_cancel_run_applies_product_visual_checkpoint_and_cancels_pending_nodes():
    cp = MemorySaver()
    tid = "thread-cancel-api-pv"
    clear_cancel(tid)
    await _seed_checkpoint(
        cp,
        tid,
        {
            "flow_mode": "product_visual",
            "phase": "orchestrate_gen",
            "gen_by_key": {
                "done": {"node_id": "n-done", "status": "completed", "url": "https://x/done.png"},
                "pending": {"node_id": "n-pending", "status": "generating"},
                "missing-node": {"status": "queued"},
            },
            "gen_completed_keys": ["done"],
        },
    )
    nest = _Nest()

    try:
        result = await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=nest,
        )
        again = await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=nest,
        )

        assert result == {
            "ok": True,
            "phase": "cancelled",
            "cancelled_node_ids": ["n-pending"],
            "completed_tasks": 1,
            "total_tasks": 3,
        }
        assert again == {
            "ok": True,
            "phase": "cancelled",
            "cancelled_node_ids": [],
            "completed_tasks": 1,
            "total_tasks": 3,
        }
        assert nest.cancelled_node_ids == ["n-pending"]
        assert is_cancel_requested(tid) is True
    finally:
        clear_cancel(tid)
