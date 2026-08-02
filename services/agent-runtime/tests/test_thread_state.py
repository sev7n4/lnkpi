"""Tests for W12 get_thread_state endpoint."""

from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.runs import get_thread_state


@pytest.mark.asyncio
async def test_get_thread_state_empty_thread():
    cp = MemorySaver()
    state = await get_thread_state("thread-empty", checkpointer=cp)
    assert state["threadId"] == "thread-empty"
    assert state["phase"] is None
    assert state["nextNodes"] == []
    assert state["interrupted"] is False
