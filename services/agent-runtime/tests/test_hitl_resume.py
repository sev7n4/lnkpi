"""Tests for HITL interrupt_before resume (P0-05)."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.hitl_resume import (
    GATE_DECISION_CLEAR,
    build_interrupt_resume_command,
    build_interrupt_state_update,
    interrupt_event_payload,
    prepare_interrupt_resume,
    should_resume_interrupt,
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


def test_should_resume_interrupt_img2img_at_topo_gate():
    msg = "@I1 这个是模特， @I2 这个是衣服，请让模特穿上这件衣服出图"
    assert should_resume_interrupt(msg, ["await_topo"]) is False


def test_should_resume_interrupt_confirm_at_topo_gate():
    assert should_resume_interrupt("确认出图", ["await_topo"]) is True


def test_should_resume_interrupt_long_plan_at_confirm_gate():
    msg = "@I1 这个是模特， @I2 这个是衣服，请让模特穿上这件衣服出图"
    assert should_resume_interrupt(msg, ["await_confirm"]) is False


def test_should_resume_interrupt_short_confirm_at_confirm_gate():
    assert should_resume_interrupt("确认", ["await_confirm"]) is True


def test_should_resume_interrupt_image_qa_retake():
    assert should_resume_interrupt("我重新拍摄上传", ["await_image_qa"]) is True


@pytest.mark.asyncio
async def test_prepare_interrupt_resume_atomic_confirm_cancel():
    """await_atomic_confirm gate resumes with as_node=create_atomic_node."""
    from langchain_core.messages import AIMessage

    from app.graph.nodes.await_atomic_confirm import make_await_atomic_confirm_node
    from app.graph.subgraphs.atomic_create_gate import route_after_atomic_confirm

    graph_def = StateGraph(AgentRuntimeState)

    async def create_atomic_node(_state: dict) -> dict:
        return {
            "phase": "atomic_create",
            "atomic_node_id": "video-1",
            "atomic_spec": {"target_type": "video", "title": "15s", "confirm_gate": True},
            "messages": [AIMessage(content="created")],
        }

    graph_def.add_node("create_atomic_node", create_atomic_node)
    graph_def.add_node("await_atomic_confirm", make_await_atomic_confirm_node())

    async def _done(_state: dict) -> dict:
        return {"phase": "done"}

    graph_def.add_node("done", _done)
    graph_def.add_edge(START, "create_atomic_node")
    graph_def.add_conditional_edges(
        "create_atomic_node",
        lambda _s: "await_atomic_confirm",
        {"await_atomic_confirm": "await_atomic_confirm"},
    )
    graph_def.add_conditional_edges(
        "await_atomic_confirm",
        route_after_atomic_confirm,
        {"run_atomic_gen": "done", "done": "done", "end": END},
    )
    graph_def.add_edge("done", END)
    graph = graph_def.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["await_atomic_confirm"],
    )
    config = {"configurable": {"thread_id": "hitl-atomic-1"}}

    await graph.ainvoke(
        {"messages": [HumanMessage(content="做一个15秒视频")]},
        config,
    )
    snap = await graph.aget_state(config)
    assert snap.next == ("await_atomic_confirm",)

    cmd = build_interrupt_resume_command("await_atomic_confirm", "取消", user_decision="revise")
    result = await graph.ainvoke(cmd, config)
    assert result.get("phase") == "done"
    assert result.get("user_decision") == "revise"
    texts = [
        str(getattr(m, "content", "") or "")
        for m in (result.get("messages") or [])
        if getattr(m, "type", None) == "ai"
    ]
    assert any("已取消" in t for t in texts)


def test_build_interrupt_resume_command_atomic_confirm():
    cmd = build_interrupt_resume_command("await_atomic_confirm", "取消", user_decision="revise")
    assert cmd.goto == "await_atomic_confirm"
    assert cmd.update["user_decision"] == "revise"


def test_should_resume_interrupt_atomic_exit_phrase():
    assert should_resume_interrupt("退出当前流程", ["await_atomic_confirm"]) is True
