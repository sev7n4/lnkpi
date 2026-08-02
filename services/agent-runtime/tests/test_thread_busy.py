"""Concurrent runs on the same thread must not clobber await_confirm state."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from app.runs import RunRequest, stream_run_events


class _Nest:
    def __init__(self) -> None:
        self.upserts = 0
        self._db_locks: set[str] = set()

    async def close(self) -> None:
        return None

    async def acquire_thread_lock(
        self, thread_id: str, holder_id: str, ttl_seconds: float = 300
    ) -> dict[str, bool]:
        if thread_id in self._db_locks:
            return {"acquired": False}
        self._db_locks.add(thread_id)
        return {"acquired": True}

    async def release_thread_lock(self, thread_id: str, holder_id: str) -> dict[str, bool]:
        self._db_locks.discard(thread_id)
        return {"released": True}

    async def renew_thread_lock(
        self, thread_id: str, holder_id: str, ttl_seconds: float = 300
    ) -> dict[str, bool]:
        return {"renewed": True}

    async def get_agent_messages(self) -> list[dict[str, str]]:
        return []

    async def save_agent_message(self, **kwargs: Any) -> dict[str, Any]:
        return {}

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
        self.upserts += 1
        return {"nodeId": "plan-1", "actions": []}

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return {"id": node_id, "data": {"content": "# plan"}}

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return {"nodes": [], "actions": []}

    async def connect_nodes(self, edges: list[dict[str, Any]]) -> dict[str, Any]:
        return {"actions": []}

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        return {"nodeId": node_id, "status": "completed", "actions": []}


class _SlowLLM:
    """Blocks inside plan LLM so a second concurrent turn can race."""

    def __init__(self, gate: asyncio.Event, release: asyncio.Event) -> None:
        self.gate = gate
        self.release = release
        self.calls = 0

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        self.calls += 1
        self.gate.set()
        await self.release.wait()
        return AIMessage(content="# 方案\n蓝牙音箱\n")


async def _collect(req: RunRequest, nest: Any, llm: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for ev in stream_run_events(
        req,
        nest=nest,
        llm=llm,
        skills_dir="skills",
        checkpointer=MemorySaver(),
    ):
        events.append(ev)
    return events


@pytest.mark.asyncio
async def test_concurrent_same_thread_returns_busy_tip():
    """Second run on the same thread must tip and exit without starting intake/plan."""
    from app.runs import THREAD_BUSY_TIP

    gate = asyncio.Event()
    release = asyncio.Event()
    nest = _Nest()
    llm = _SlowLLM(gate, release)
    tid = "thread-busy-1"
    sid = "sess-busy-1"

    async def first() -> list[dict[str, Any]]:
        return await _collect(
            RunRequest(
                session_id=sid,
                user_id="u1",
                thread_id=tid,
                message="帮我规划蓝牙音箱电商主图",
            ),
            nest,
            llm,
        )

    task1 = asyncio.create_task(first())
    await asyncio.wait_for(gate.wait(), timeout=5)

    events2 = await _collect(
        RunRequest(
            session_id=sid,
            user_id="u1",
            thread_id=tid,
            message="确认",
        ),
        nest,
        llm,
    )
    release.set()
    await task1

    texts = [
        str((e.get("data") or {}).get("text") or "")
        for e in events2
        if e.get("type") == "text_delta"
    ]
    assert any(THREAD_BUSY_TIP in t for t in texts)
    assert any(e.get("type") == "done" for e in events2)
    # Second turn must not kick another plan LLM while first holds the lock
    assert llm.calls == 1
    assert nest.upserts == 0


@pytest.mark.asyncio
async def test_concurrent_modify_intent_returns_friendly_tip():
    """修复 P0-2：出图过程中用户发送修改意见 → 友好提示（而非生硬 busy tip）。"""
    from app.runs import _MODIFY_DURING_GEN_TIP

    gate = asyncio.Event()
    release = asyncio.Event()
    nest = _Nest()
    llm = _SlowLLM(gate, release)
    tid = "thread-busy-modify-1"
    sid = "sess-busy-modify-1"

    async def first() -> list[dict[str, Any]]:
        return await _collect(
            RunRequest(
                session_id=sid,
                user_id="u1",
                thread_id=tid,
                message="帮我规划蓝牙音箱电商主图",
            ),
            nest,
            llm,
        )

    task1 = asyncio.create_task(first())
    await asyncio.wait_for(gate.wait(), timeout=5)

    # 第二轮：用户发送修改意见（应返回友好提示）
    events2 = await _collect(
        RunRequest(
            session_id=sid,
            user_id="u1",
            thread_id=tid,
            message="把主图改成更鲜艳的配色",
        ),
        nest,
        llm,
    )
    release.set()
    await task1

    texts = [
        str((e.get("data") or {}).get("text") or "")
        for e in events2
        if e.get("type") == "text_delta"
    ]
    # 应该返回友好提示，而不是生硬的 busy tip
    assert any(_MODIFY_DURING_GEN_TIP in t for t in texts)
    assert any(e.get("type") == "done" for e in events2)
    # 不应该启动第二轮 plan LLM
    assert llm.calls == 1
    assert nest.upserts == 0


@pytest.mark.asyncio
async def test_orphan_local_lock_recovered_when_db_free():
    """Worker crash can leave asyncio.Lock held while DB lease is gone."""
    import asyncio

    from app.runs import _release_thread, _thread_locks, _try_acquire_thread

    class LockNest:
        def __init__(self) -> None:
            self._db_locks: set[str] = set()

        async def acquire_thread_lock(
            self, thread_id: str, holder_id: str, ttl_seconds: float = 300
        ) -> dict[str, bool]:
            if thread_id in self._db_locks:
                return {"acquired": False}
            self._db_locks.add(thread_id)
            return {"acquired": True}

        async def release_thread_lock(self, thread_id: str, holder_id: str) -> dict[str, bool]:
            self._db_locks.discard(thread_id)
            return {"released": True}

    tid = "orphan-thread-1"
    nest = LockNest()
    orphan = asyncio.Lock()
    await orphan.acquire()
    _thread_locks[tid] = orphan

    acquired, holder = await _try_acquire_thread(tid, nest)  # type: ignore[arg-type]
    assert acquired is True
    assert holder is not None

    await _release_thread(tid, holder, nest)  # type: ignore[arg-type]
    _thread_locks.pop(tid, None)
