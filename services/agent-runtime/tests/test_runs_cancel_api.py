from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.config import settings
from app.graph.builder import build_agent_graph
from app.main import app, clear_run_overrides, configure_run_overrides
from app.run_cancel import clear_cancel, is_cancel_requested, request_cancel
from app.runs import CancelRunRequest, RunRequest, cancel_run, stream_run_events


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
    configure_run_overrides(checkpointer=cp, nest=_Nest())
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
        assert is_cancel_requested(tid) is False
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
        assert is_cancel_requested(tid) is False
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_cancel_run_busy_product_visual_only_sets_cooperative_flag():
    cp = MemorySaver()
    tid = "thread-cancel-api-busy-pv"
    clear_cancel(tid)
    await _seed_checkpoint(
        cp,
        tid,
        {
            "flow_mode": "product_visual",
            "phase": "orchestrate_gen",
            "gen_by_key": {"pending": {"node_id": "n-pending", "status": "generating"}},
            "gen_completed_keys": [],
        },
    )
    nest = _Nest()
    nest._db_locks.add(tid)

    try:
        result = await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=nest,
        )

        assert result["ok"] is True
        assert result["phase"] == "orchestrate_gen"
        assert result["cancelled_node_ids"] == []
        assert is_cancel_requested(tid) is True
        assert nest.cancelled_node_ids == []

        graph = build_agent_graph(
            nest=_Nest(),
            llm=None,
            skills_dir=Path(__file__).resolve().parents[1] / "skills",
            checkpointer=cp,
        )
        snap = await graph.aget_state({"configurable": {"thread_id": tid}})
        assert snap.values.get("phase") == "orchestrate_gen"
        assert snap.values.get("run_cancelled") is not True
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_cancel_run_non_product_visual_clears_stale_flag():
    cp = MemorySaver()
    tid = "thread-cancel-api-atomic"
    clear_cancel(tid)
    await _seed_checkpoint(
        cp,
        tid,
        {
            "flow_mode": "atomic",
            "phase": "execute",
        },
    )
    request_cancel(tid)

    try:
        result = await cancel_run(
            CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
            checkpointer=cp,
            nest=_Nest(),
        )

        assert result["skipped"] is True
        assert result["reason"] == "flow_not_supported"
        assert is_cancel_requested(tid) is False
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_cancel_run_builds_and_closes_default_nest(monkeypatch):
    cp = MemorySaver()
    tid = "thread-cancel-api-default-nest"
    clear_cancel(tid)
    await _seed_checkpoint(
        cp,
        tid,
        {
            "flow_mode": "product_visual",
            "phase": "orchestrate_gen",
            "gen_by_key": {"pending": {"node_id": "n-pending", "status": "generating"}},
            "gen_completed_keys": [],
        },
    )
    production_nest = _Nest()
    closed = False

    async def close() -> None:
        nonlocal closed
        closed = True

    production_nest.close = close  # type: ignore[method-assign]
    monkeypatch.setattr("app.runs.default_nest", lambda **_kwargs: production_nest)

    result = await cancel_run(
        CancelRunRequest(thread_id=tid, session_id="s1", reason="user"),
        checkpointer=cp,
    )

    assert result["phase"] == "cancelled"
    assert production_nest.cancelled_node_ids == ["n-pending"]
    assert closed is True
    assert is_cancel_requested(tid) is False


@pytest.mark.asyncio
async def test_stream_clears_flag_after_cooperative_product_visual_cancel(monkeypatch):
    tid = "thread-stream-clear-cooperative-cancel"
    clear_cancel(tid)
    request_cancel(tid)

    class _Snapshot:
        next: list[str] = []

        def __init__(self, values: dict[str, Any]) -> None:
            self.values = values

    class _Graph:
        def __init__(self) -> None:
            self.values = {
                "flow_mode": "product_visual",
                "phase": "orchestrate_gen",
                "gen_by_key": {
                    "done": {"node_id": "n-done"},
                    "pending": {"node_id": "n-pending"},
                },
                "gen_completed_keys": ["done", "legacy-completed"],
            }

        async def aget_state(self, _config: dict[str, Any]) -> _Snapshot:
            return _Snapshot(dict(self.values))

        async def astream(self, *_args: Any, **_kwargs: Any):
            yield {"gen_scheduler": {"gen_completed_keys": ["done"]}}

        async def aupdate_state(
            self,
            _config: dict[str, Any],
            update: dict[str, Any],
            **_kwargs: Any,
        ) -> None:
            self.values.update(update)

    graph = _Graph()
    monkeypatch.setattr("app.runs.build_agent_graph", lambda **_kwargs: graph)
    monkeypatch.setattr("app.runs._load_history", lambda *_args: _async_empty_list())
    nest = _Nest()

    try:
        events = [
            event
            async for event in stream_run_events(
                RunRequest(
                    session_id="s1",
                    user_id="u1",
                    message="继续",
                    thread_id=tid,
                ),
                nest=nest,
                llm=object(),
                checkpointer=object(),
            )
        ]
        cancelled = next(event for event in events if event["type"] == "run_cancelled")
        assert cancelled["data"]["completedTasks"] == 2
        assert graph.values["phase"] == "cancelled"
        assert is_cancel_requested(tid) is False
    finally:
        clear_cancel(tid)


async def _async_empty_list() -> list[Any]:
    return []


def test_cancel_run_rejects_blank_thread_id():
    with pytest.raises(ValueError):
        CancelRunRequest(thread_id="   ", session_id="s1")
