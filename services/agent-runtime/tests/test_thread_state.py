"""Tests for W12 get_thread_state endpoint."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph
from app.graph.product_visual_v2.journey_trace import (
    build_journey_trace_snapshot,
    patch_macro_select_step,
)
from app.runs import (
    _emit_journey_trace_for_presentation,
    _resolve_journey_trace,
    emit_journey_update,
    get_thread_state,
)


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


@pytest.mark.asyncio
async def test_resolve_journey_trace_merges_stale_checkpoint_with_current_phase():
    stale = build_journey_trace_snapshot(
        {
            "macro_schemes": [
                {"id": "A", "label": "湖鲜原境风"},
                {"id": "B", "label": "礼盒臻享风"},
            ],
            "selected_macro_scheme_ids": ["A"],
        },
        phase="canvas_ssot_commit",
    )
    patched = patch_macro_select_step(
        stale,
        schemes=[
            {"id": "A", "label": "湖鲜原境风"},
            {"id": "B", "label": "礼盒臻享风"},
        ],
        selected_ids=["A"],
    )
    assert patched["current"] == "ssot_persist"

    resolved = _resolve_journey_trace(
        {
            "flow_mode": "chat",
            "phase": "done",
            "journey_trace": patched,
            "selected_macro_scheme_ids": ["A"],
            "macro_schemes": [
                {"id": "A", "label": "湖鲜原境风"},
                {"id": "B", "label": "礼盒臻享风"},
            ],
        }
    )
    assert isinstance(resolved, dict)
    assert resolved["current"] == "done"
    assert all(s["status"] == "done" for s in resolved["steps"])
    macro = next(s for s in resolved["steps"] if s["id"] == "macro_select")
    assert macro["summary"] == "已选：湖鲜原境风"


@pytest.mark.asyncio
async def test_emit_journey_trace_for_presentation_advances_existing_trace():
    events: list[dict] = []

    async def emit(event: dict) -> None:
        events.append(event)

    stale = build_journey_trace_snapshot(
        {"macro_schemes": [{"id": "A", "label": "湖鲜原境风"}]},
        phase="await_macro_scheme_select",
    )
    stream_vals = {
        "phase": "await_shot_topo_confirm",
        "journey_trace": stale,
        "macro_schemes": [{"id": "A", "label": "湖鲜原境风"}],
        "selected_macro_scheme_ids": ["A"],
    }
    delta = {"presentation": {"kind": "shot_topo_merged", "stepper": {"current": "topo_preview"}}}

    await _emit_journey_trace_for_presentation(emit, stream_vals, delta)

    assert len(events) == 1
    snap = events[0]["data"]["snapshot"]
    assert snap["current"] == "topo_preview"
    assert stream_vals["journey_trace"]["current"] == "topo_preview"


@pytest.mark.asyncio
async def test_get_thread_state_includes_journey_trace():
    cp = MemorySaver()
    graph = build_agent_graph(
        nest=type("_N", (), {"close": lambda self: None})(),
        llm=None,
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=cp,
    )
    trace = build_journey_trace_snapshot(
        {
            "macro_schemes": [
                {"id": "A", "label": "湖鲜原境风"},
                {"id": "B", "label": "礼盒臻享风"},
            ],
        },
        phase="await_macro_scheme_select",
    )
    config = {"configurable": {"thread_id": "t-journey"}}
    await graph.aupdate_state(
        config,
        {
            "messages": [HumanMessage(content="帮我做礼盒主视觉")],
            "flow_mode": "product_visual",
            "phase": "await_macro_scheme_select",
            "selected_macro_scheme_ids": ["A"],
            "journey_trace": trace,
            "thread_id": "t-journey",
            "session_id": "s1",
            "user_id": "u1",
        },
    )
    state = await get_thread_state("t-journey", checkpointer=cp)
    assert state["selectedMacroSchemeIds"] == ["A"]
    jt = state["journeyTrace"]
    assert isinstance(jt, dict)
    assert jt["flowMode"] == "product_visual"
    assert jt["current"] == "macro_select"
    assert len(jt["steps"]) == 9


@pytest.mark.asyncio
async def test_emit_journey_update_emits_product_visual_snapshot():
    events: list[dict] = []

    async def emit(event: dict) -> None:
        events.append(event)

    trace = build_journey_trace_snapshot({}, phase="await_image_qa")
    await emit_journey_update(emit, {"journey_trace": trace})
    assert len(events) == 1
    assert events[0]["type"] == "journey_update"
    assert events[0]["data"]["snapshot"]["flowMode"] == "product_visual"


@pytest.mark.asyncio
async def test_emit_journey_update_skips_missing_or_non_pv():
    events: list[dict] = []

    async def emit(event: dict) -> None:
        events.append(event)

    await emit_journey_update(emit, {})
    await emit_journey_update(emit, {"journey_trace": {"flowMode": "campaign"}})
    assert events == []
