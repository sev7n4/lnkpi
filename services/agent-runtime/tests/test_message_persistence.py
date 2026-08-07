"""Nest is the single writer for AgentMessage; runtime must not duplicate saves."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from app.runs import RunRequest, stream_run_events

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


class _Nest:
    def __init__(self) -> None:
        self.save_calls: list[dict[str, Any]] = []
        self.get_messages_calls: list[str] = []
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

    async def get_agent_messages(self, *, thread_id: str) -> list[dict[str, str]]:
        self.get_messages_calls.append(thread_id)
        return []

    async def save_agent_message(self, **kwargs: Any) -> dict[str, Any]:
        self.save_calls.append(kwargs)
        return {"id": "msg-1"}

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
        return {"nodeId": "plan-1", "actions": []}

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return {"id": node_id, "data": {}}

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


class _LLM:
    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        return AIMessage(content="# 方案\n测试产品\n")


async def _collect(req: RunRequest, nest: _Nest) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for ev in stream_run_events(
        req,
        nest=nest,
        llm=_LLM(),
        skills_dir=SKILLS_DIR,
        checkpointer=MemorySaver(),
    ):
        events.append(ev)
    return events


@pytest.mark.asyncio
async def test_stream_run_does_not_call_save_user_message():
    save_user = AsyncMock()
    save_assistant = AsyncMock()
    with (
        patch("app.runs._save_user_message", save_user),
        patch("app.runs._save_new_assistant_messages", save_assistant),
    ):
        nest = _Nest()
        thread_id = "thread-persist-1"
        await _collect(
            RunRequest(
                session_id="sess-persist-1",
                user_id="u1",
                thread_id=thread_id,
                message="帮我规划产品主图",
            ),
            nest,
        )

        save_user.assert_not_called()
        save_assistant.assert_not_called()
        assert nest.save_calls == []


@pytest.mark.asyncio
async def test_load_history_scoped_by_thread_id():
    nest = _Nest()
    thread_id = "thread-persist-2"
    await _collect(
        RunRequest(
            session_id="sess-persist-2",
            user_id="u1",
            thread_id=thread_id,
            message="帮我规划产品主图",
        ),
        nest,
    )

    assert nest.get_messages_calls == [thread_id]
