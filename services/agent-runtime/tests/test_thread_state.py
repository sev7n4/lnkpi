"""Tests for W12 get_thread_state endpoint."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph
from app.runs import get_thread_state


@pytest.mark.asyncio
async def test_get_thread_state_empty_thread():
    cp = MemorySaver()
    state = await get_thread_state("thread-empty", checkpointer=cp)
    assert state["threadId"] == "thread-empty"
    assert state["phase"] is None
    assert state["nextNodes"] == []
    assert state["interrupted"] is False
    assert state["hasAtomicCheckpoint"] is False
    assert state["atomicNodeId"] is None


@pytest.mark.asyncio
async def test_get_thread_state_includes_atomic_checkpoint(tmp_path):
    cp = MemorySaver()
    graph = build_agent_graph(
        nest=type("_N", (), {"close": lambda self: None})(),
        llm=None,
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=cp,
    )
    config = {"configurable": {"thread_id": "t-atomic-diag"}}
    await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我生成一个模特人物图")],
            "atomic_node_id": "node-x",
            "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特"},
            "flow_mode": "atomic_create",
            "phase": "done",
            "thread_id": "t-atomic-diag",
            "session_id": "s1",
            "user_id": "u1",
        },
        config,
    )
    state = await get_thread_state("t-atomic-diag", checkpointer=cp)
    assert state["hasAtomicCheckpoint"] is True
    assert state["atomicNodeId"] == "node-x"
    assert state["atomicTargetType"] == "image"
