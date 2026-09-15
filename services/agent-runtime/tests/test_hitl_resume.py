"""Tests for HITL interrupt_before resume (P0-05)."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.hitl_resume import (
    FRESH_TURN_STATE_CLEAR,
    GATE_DECISION_CLEAR,
    GATE_RESUME_AS_NODE,
    GATE_RESUME_COMMAND_GOTO,
    RETIRED_INTERRUPT_GATES,
    build_fresh_turn_command,
    build_interrupt_resume_command,
    build_interrupt_state_update,
    build_retired_atomic_confirm_command,
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


def test_should_resume_interrupt_macro_scheme_confirm():
    assert should_resume_interrupt("确认方案", ["await_macro_scheme_select"]) is True


def test_should_resume_interrupt_macro_scheme_json():
    msg = '__macro_scheme_decision__{"action":"confirm","selected_ids":["A","B"]}'
    assert should_resume_interrupt(msg, ["await_macro_scheme_select"]) is True


def test_should_resume_interrupt_macro_scheme_free_text_revise():
    msg = "商业特写，但是需要增加更多模特展示图和包装的各类视角细节"
    assert should_resume_interrupt(msg, ["await_macro_scheme_select"]) is True


def test_should_resume_interrupt_macro_scheme_long_ref_still_fresh_turn():
    msg = "@I1 这个是模特， @I2 这个是衣服，请让模特穿上这件衣服出图"
    assert should_resume_interrupt(msg, ["await_macro_scheme_select"]) is False


def test_should_resume_interrupt_shot_confirm():
    assert should_resume_interrupt("确认出图", ["await_shot_confirm"]) is True


def test_should_resume_interrupt_shot_revise():
    assert should_resume_interrupt("调整构图", ["await_shot_confirm"]) is True


def test_should_resume_interrupt_image_qa_retake():
    assert should_resume_interrupt("我重新拍摄上传", ["await_image_qa"]) is True


def test_g6_await_atomic_confirm_resume_neutralized():
    """G6: legacy await_atomic_confirm must not resume into billable run_atomic_gen."""
    assert "await_atomic_confirm" in RETIRED_INTERRUPT_GATES
    assert "await_atomic_confirm" not in GATE_RESUME_COMMAND_GOTO
    assert "await_atomic_confirm" not in GATE_RESUME_AS_NODE
    assert GATE_RESUME_COMMAND_GOTO == frozenset()
    assert GATE_RESUME_AS_NODE == {}

    # Confirm / cancel / injected user_decision must NOT schedule gate resume.
    assert should_resume_interrupt("确认", ["await_atomic_confirm"]) is False
    assert should_resume_interrupt("退出当前流程", ["await_atomic_confirm"]) is False
    assert (
        should_resume_interrupt(
            "确认",
            ["await_atomic_confirm"],
            user_decision="confirm",
        )
        is False
    )

    cmd = build_retired_atomic_confirm_command(
        update={
            "messages": [HumanMessage(content="确认")],
            "atomic_spec": {"target_type": "video", "confirm_gate": True},
            "atomic_node_id": "video-1",
        }
    )
    assert cmd.goto == "parse_sidebar_media"
    assert cmd.goto != "run_atomic_gen"
    assert cmd.goto != "await_atomic_confirm"
    assert cmd.update.get("atomic_spec") is None
    assert cmd.update.get("atomic_node_id") is None
    assert cmd.update.get("atomic_items") is None
    texts = [
        str(getattr(m, "content", "") or "")
        for m in (cmd.update.get("messages") or [])
        if getattr(m, "type", None) == "ai"
    ]
    assert any("画布节点" in t for t in texts)


def test_build_interrupt_resume_command_atomic_confirm_redirects():
    """Even Command(goto=...) helpers must not jump to await_atomic_confirm / run_atomic_gen."""
    cmd = build_interrupt_resume_command(
        "await_atomic_confirm",
        "确认",
        user_decision="confirm",
    )
    assert cmd.goto == "parse_sidebar_media"
    assert cmd.goto != "await_atomic_confirm"
    assert cmd.goto != "run_atomic_gen"
    assert cmd.update.get("atomic_spec") is None


def test_build_fresh_turn_command_goes_to_parse_sidebar_media():
    cmd = build_fresh_turn_command(update={})
    assert cmd.goto == "parse_sidebar_media"
    assert FRESH_TURN_STATE_CLEAR["sidebar_media_parse"] is None
    assert cmd.update["sidebar_media_parse"] is None
    assert "sidebar_media_parse_cache" not in FRESH_TURN_STATE_CLEAR


@pytest.mark.asyncio
async def test_prepare_interrupt_resume_refuses_retired_atomic_confirm():
    graph_def = StateGraph(AgentRuntimeState)

    async def stub(_state: dict) -> dict:
        return {"phase": "done"}

    graph_def.add_node("await_atomic_confirm", stub)
    graph_def.add_edge(START, "await_atomic_confirm")
    graph_def.add_edge("await_atomic_confirm", END)
    graph = graph_def.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["await_atomic_confirm"],
    )
    config = {"configurable": {"thread_id": "hitl-atomic-retired"}}
    await graph.ainvoke({"messages": [HumanMessage(content="brief")]}, config)
    snap = await graph.aget_state(config)
    assert snap.next == ("await_atomic_confirm",)

    with pytest.raises(ValueError, match="retired gate"):
        await prepare_interrupt_resume(graph, config, "确认", user_decision="confirm")
