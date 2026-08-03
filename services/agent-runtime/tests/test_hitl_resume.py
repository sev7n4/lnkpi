"""Tests for HITL interrupt_before resume (P0-05)."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.hitl_resume import (
    GATE_DECISION_CLEAR,
    build_interrupt_state_update,
    interrupt_event_payload,
    prepare_interrupt_resume,
)
from app.graph.nodes.await_confirm import make_await_confirm_node
from langgraph.graph import END, START, StateGraph

from app.graph.state import AgentRuntimeState


def test_build_interrupt_state_update():
    upd = build_interrupt_state_update("确认", user_decision="confirm")
    assert upd["user_decision"] == "confirm"
    assert upd["messages"][0].content == "确认"


def test_interrupt_event_payload():
    ev = interrupt_event_payload(next_nodes=["await_topo"], phase="await_topo")
    assert ev["type"] == "interrupt"
    assert ev["data"]["node"] == "await_topo"
    assert ev["data"]["phase"] == "await_topo"


@pytest.mark.asyncio
async def test_prepare_interrupt_resume_continues_gate():
    """inject message + ainvoke(None) re-runs await_confirm with user reply."""

    class FakeLLM:
        async def ainvoke(self, messages, **kwargs):
            from langchain_core.messages import AIMessage

            return AIMessage(content="confirm")

    graph_def = StateGraph(AgentRuntimeState)
    graph_def.add_node("await_confirm", make_await_confirm_node(llm=FakeLLM()))
    graph_def.add_edge(START, "await_confirm")
    graph_def.add_edge("await_confirm", END)
    graph = graph_def.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["await_confirm"],
    )
    config = {"configurable": {"thread_id": "hitl-1"}}

    await graph.ainvoke({"messages": [HumanMessage(content="brief")]}, config)
    snap = await graph.aget_state(config)
    assert snap.next == ("await_confirm",)

    _, _ = await prepare_interrupt_resume(graph, config, "1")
    result = await graph.ainvoke(None, config)
    assert result.get("user_decision") == "confirm"


def test_gate_decision_clear_keys():
    assert GATE_DECISION_CLEAR["user_decision"] == "none"
    assert GATE_DECISION_CLEAR["force_choice"] is None
