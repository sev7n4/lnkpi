"""Post-cancel turn resolution and reconnect thread-state tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph
from app.runs import get_thread_state, resolve_turn_input


def test_resolve_turn_input_new_task_after_cancel():
    pre = {
        "phase": "cancelled",
        "run_cancelled": True,
        "flow_mode": "product_visual",
        "shot_manifest": [{"shot_id": "s1"}],
    }
    turn_update = {
        "messages": [HumanMessage(content="__new_task__")],
        "session_id": "s",
    }

    input_state = resolve_turn_input(pre, [], "__new_task__", None, turn_update)

    assert input_state.goto == "intake"
    assert input_state.update["shot_manifest"] is None
    assert input_state.update["run_cancelled"] is None
    assert input_state.update["cancelled_from_phase"] is None
    # M7: a fresh task must also drop the whole gen run channel.
    for key in ("gen_by_key", "gen_completed_keys", "gen_failed_keys", "gen_progress_id"):
        assert input_state.update[key] is None


def test_resolve_turn_input_revise_after_gen_phase_cancel_keeps_upstream_ssot():
    """§4.3: a gen-phase revise reuses the confirmed macro + shot SSOT."""
    turn_update = {
        "messages": [HumanMessage(content="换成白底风格")],
        "session_id": "s",
    }

    input_state = resolve_turn_input(
        {
            "phase": "cancelled",
            "cancelled_from_phase": "orchestrate_gen",
            "run_cancelled": True,
        },
        [],
        "换成白底风格",
        None,
        turn_update,
    )

    assert input_state.goto == "intake"
    assert "shot_manifest" not in input_state.update
    assert "selected_macro_scheme_ids" not in input_state.update
    assert input_state.update["gen_by_key"] is None
    assert input_state.update["delivery_selections"] is None
    assert input_state.update["cancel_reason"] is None
    assert input_state.update["cancelled_from_phase"] is None
    assert input_state.update["messages"] == turn_update["messages"]


def test_resolve_turn_input_revise_without_origin_phase_clears_downstream():
    """Without ``cancelled_from_phase`` nothing downstream can be trusted."""
    turn_update = {
        "messages": [HumanMessage(content="换成白底风格")],
        "session_id": "s",
    }

    input_state = resolve_turn_input(
        {"phase": "cancelled", "run_cancelled": True},
        [],
        "换成白底风格",
        None,
        turn_update,
    )

    assert input_state.goto == "intake"
    assert input_state.update["shot_manifest"] is None
    assert input_state.update["selected_macro_scheme_ids"] is None
    assert input_state.update["cancel_reason"] is None
    assert input_state.update["cancelled_from_phase"] is None


def test_resolve_turn_input_revise_after_shot_phase_cancel_keeps_macro_choice():
    turn_update = {
        "messages": [HumanMessage(content="去掉第三张")],
        "session_id": "s",
    }

    input_state = resolve_turn_input(
        {
            "phase": "cancelled",
            "cancelled_from_phase": "await_shot_topo_confirm",
            "run_cancelled": True,
        },
        [],
        "去掉第三张",
        None,
        turn_update,
    )

    assert input_state.update["shot_manifest"] is None
    assert "selected_macro_scheme_ids" not in input_state.update


def test_resolve_turn_input_preserves_non_cancelled_paths():
    turn_update = {
        "messages": [HumanMessage(content="继续聊")],
        "session_id": "s",
    }

    assert resolve_turn_input({}, [], "继续聊", None, turn_update) is turn_update

    fresh = resolve_turn_input(
        {"phase": "await_confirm"},
        ["await_confirm"],
        "@I1 这个是模特， @I2 这个是衣服，请让模特穿上这件衣服出图",
        None,
        turn_update,
    )
    assert fresh.goto == "intake"


def test_resolve_turn_input_defers_gate_resume_to_async_path():
    turn_update = {
        "messages": [HumanMessage(content="确认出图")],
        "session_id": "s",
    }

    assert (
        resolve_turn_input(
            {"phase": "cancelled", "run_cancelled": True},
            ["await_shot_topo_confirm"],
            "确认出图",
            None,
            turn_update,
        )
        is None
    )


@pytest.mark.asyncio
async def test_get_thread_state_reports_cancelled_as_unfinished():
    checkpointer = MemorySaver()
    graph = build_agent_graph(
        nest=type("_N", (), {"close": lambda self: None})(),
        llm=None,
        skills_dir=Path(__file__).resolve().parents[1] / "skills",
        checkpointer=checkpointer,
    )
    config = {"configurable": {"thread_id": "cancelled-thread"}}
    await graph.aupdate_state(
        config,
        {
            "messages": [HumanMessage(content="停止")],
            "phase": "cancelled",
            "run_cancelled": True,
            "thread_id": "cancelled-thread",
            "session_id": "s",
            "user_id": "u",
        },
    )

    state = await get_thread_state("cancelled-thread", checkpointer=checkpointer)

    assert state["phase"] == "cancelled"
    assert state["runCancelled"] is True
    assert state["finished"] is False
