"""product_visual Phase 1 image QA gate tests."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.image_qa_gate import (
    classify_image_qa_decision,
    clear_product_visual_abort_state,
    evaluate_image_qa,
    make_await_image_qa_node,
    make_image_qa_check_node,
    make_image_qa_remedy_node,
    make_plan_product_visual_stub_node,
)
from app.graph.state import AgentRuntimeState
from app.graph.subgraphs.product_visual_gate import register_product_visual_gate


def test_qa_pass_clears_popup():
    r = evaluate_image_qa({"sharpness": 0.9, "has_white_bg": True})
    assert r["image_qa_result"] == "pass"


def test_qa_fail_triggers_hitl():
    r = evaluate_image_qa({"sharpness": 0.2, "has_white_bg": False})
    assert r["image_qa_result"] == "fail"
    assert r["phase"] == "await_image_qa"


def test_qa_interior_relaxes_white_bg():
    r = evaluate_image_qa({"sharpness": 0.8, "has_white_bg": False, "scene_kind": "interior"})
    assert r["image_qa_result"] == "pass"


def test_abort_clears_state():
    dirty = {
        "product_visual_plan": {"image_types": []},
        "image_qa_result": "fail",
        "phase1_asset_keys": ["white_bg"],
    }
    clean = clear_product_visual_abort_state(dirty)
    assert clean.get("product_visual_plan") is None
    assert clean.get("image_qa_result") is None


def test_classify_image_qa_decision():
    assert classify_image_qa_decision("我重新拍摄上传") == "retake"
    assert classify_image_qa_decision("生成标准白底图") == "ai_white_bg"
    assert classify_image_qa_decision("随便说说") == "none"


@pytest.mark.asyncio
async def test_image_qa_check_pass_sets_phase1_keys():
    node = make_image_qa_check_node()
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.9, "has_white_bg": True}
            ],
        }
    )
    assert out["image_qa_result"] == "pass"
    assert out["phase1_asset_keys"] == ["white_bg", "product_turnaround"]


@pytest.mark.asyncio
async def test_image_qa_check_fail_emits_tip():
    node = make_image_qa_check_node()
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.1, "has_white_bg": False}
            ],
        }
    )
    assert out["image_qa_result"] == "fail"
    assert out["phase"] == "await_image_qa"
    assert out.get("messages")


@pytest.mark.asyncio
async def test_await_image_qa_remedy_retake_aborts():
    await_node = make_await_image_qa_node()
    remedy = make_image_qa_remedy_node()
    pending = await await_node({"messages": []})
    assert pending["image_qa_decision"] == "none"

    decided = await await_node({"messages": [HumanMessage(content="我重新拍摄上传")]})
    assert decided["image_qa_decision"] == "retake"

    remedied = await remedy({**decided, "product_visual_plan": {"image_types": []}})
    assert remedied["phase"] == "done"
    assert remedied.get("product_visual_plan") is None


@pytest.mark.asyncio
async def test_await_image_qa_remedy_ai_white_bg():
    await_node = make_await_image_qa_node()
    remedy = make_image_qa_remedy_node()
    decided = await await_node({"messages": [HumanMessage(content="生成标准白底图")]})
    remedied = await remedy(decided)
    assert remedied["image_qa_result"] == "remediated"
    assert remedied["phase"] == "plan_product_visual"
    assert remedied["phase1_asset_keys"] == ["white_bg", "product_turnaround"]


@pytest.mark.asyncio
async def test_plan_product_visual_stub():
    node = make_plan_product_visual_stub_node()
    out = await node({})
    assert out["phase"] == "plan_product_visual"


def test_product_visual_gate_subgraph_compiles():
    graph = StateGraph(AgentRuntimeState)
    register_product_visual_gate(graph)
    graph.add_edge(START, "image_qa_check")
    compiled = graph.compile(interrupt_before=["await_image_qa"])
    assert compiled is not None
