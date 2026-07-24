"""Concurrent runs on the same thread must not clobber await_confirm state."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.runs import RunRequest, stream_run_events


class _SlowNest:
    """Blocks inside upsert so a second concurrent turn can race."""

    def __init__(self, gate: asyncio.Event, release: asyncio.Event) -> None:
        self.gate = gate
        self.release = release
        self.upserts = 0

    async def close(self) -> None:
        return None

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
        self.upserts += 1
        self.gate.set()
        await self.release.wait()
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


class _FakeLLM:
    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        return AIMessage(content="# 方案\n蓝牙音箱\n")


async def _collect(req: RunRequest, nest: Any, llm: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for ev in stream_run_events(req, nest=nest, llm=llm, skills_dir="skills"):
        events.append(ev)
    return events


@pytest.mark.asyncio
async def test_concurrent_same_thread_returns_busy_tip():
    """Second run on the same thread must tip and exit without starting intake/plan."""
    from app.runs import THREAD_BUSY_TIP

    gate = asyncio.Event()
    release = asyncio.Event()
    nest = _SlowNest(gate, release)
    llm = _FakeLLM()
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
    # Second turn must not kick another upsert/plan while first holds the lock
    assert nest.upserts == 1
