"""product_visual Phase 1 image QA gate tests."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.image_qa_gate import (
    REMEDIATE_DONE_MSG,
    REMEDIATE_PROGRESS_MSG,
    classify_image_qa_decision,
    clear_product_visual_abort_state,
    evaluate_image_qa,
    make_await_image_qa_node,
    make_image_qa_check_node,
    make_image_qa_remedy_node,
)
from app.graph.state import AgentRuntimeState
from app.graph.subgraphs.product_visual_gate import (
    register_product_visual_gate,
    route_after_image_qa_check,
    route_after_image_qa_remedy,
    route_after_plan_product_visual,
)


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self._seq = 0

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items, kwargs))
        nodes = []
        for item in items:
            self._seq += 1
            nodes.append({"key": item["key"], "nodeId": f"node-{item['key']}"})
        return {"nodes": nodes, "actions": []}

    async def connect_nodes(self, edges: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("connect_nodes", edges, kwargs))
        return {"actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("attach_refs", {"node_id": node_id, "ref_order": ref_order}, kwargs))
        return {"nodeId": node_id, "actions": []}

    async def apply_sidebar_attachments(
        self,
        *,
        node_ids: list[str],
        attachments: list[dict[str, Any]],
        ref_order: list[str] | None,
        mode: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "apply_sidebar_attachments",
                {"node_ids": node_ids, "attachments": attachments, "mode": mode},
                kwargs,
            )
        )
        return {"sourceNodeIds": ["src-product"], "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"nodeId": node_id, "status": "completed", "url": "https://cdn.example/img.png"}


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
    nest = FakeNest()
    node = make_image_qa_check_node(nest=nest)
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.9, "has_white_bg": True}
            ],
        }
    )
    assert out["image_qa_result"] == "pass"
    assert out["phase1_asset_keys"] == ["white_bg", "product_turnaround"]
    assert {it["key"] for it in out["split_manifest"]} == {"white_bg", "product_turnaround"}
    assert any(c[0] == "add_nodes_batch" for c in nest.calls)


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
    nest = FakeNest()
    await_node = make_await_image_qa_node()
    remedy = make_image_qa_remedy_node(nest=nest)
    decided = await await_node({"messages": [HumanMessage(content="生成标准白底图")]})
    remedied = await remedy(
        {
            **decided,
            "sidebar_attachments": [{"mediaType": "image", "role": "product", "url": "u1"}],
        }
    )
    assert remedied["image_qa_result"] == "remediated"
    assert remedied["phase"] == "plan_product_visual"
    assert remedied["phase1_asset_keys"] == ["white_bg", "product_turnaround"]
    assert {it["key"] for it in remedied["split_manifest"]} == {"white_bg", "product_turnaround"}
    gen_calls = [c for c in nest.calls if c[0] == "run_image_generation"]
    assert [c[1] for c in gen_calls] == ["node-white_bg", "node-product_turnaround"]
    msgs = [m.content for m in remedied.get("messages") or [] if isinstance(m, AIMessage)]
    assert msgs[0] == REMEDIATE_PROGRESS_MSG
    assert msgs[-1] == REMEDIATE_DONE_MSG


@pytest.mark.asyncio
async def test_image_qa_check_pass_skips_existing_nodes():
    nest = FakeNest()
    node = make_image_qa_check_node(nest=nest)
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.9, "has_white_bg": True}
            ],
            "split_manifest": [
                {"key": "white_bg", "node_id": "existing-wb", "target_type": "image"},
                {"key": "product_turnaround", "node_id": "existing-ta", "target_type": "image"},
            ],
        }
    )
    assert out["image_qa_result"] == "pass"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)


def test_route_after_image_qa_check_pass_goes_plan():
    assert route_after_image_qa_check({"image_qa_result": "pass"}) == "plan_product_visual"
    assert route_after_image_qa_check({"image_qa_result": "remediated"}) == "plan_product_visual"


def test_route_after_plan_product_visual_multi_scheme():
    assert (
        route_after_plan_product_visual(
            {
                "phase": "await_scheme_select",
                "product_visual_plan": {"image_types": [{"schemes": [{}, {}]}]},
            }
        )
        == "await_scheme_select"
    )


def test_route_after_plan_product_visual_single_scheme():
    assert (
        route_after_plan_product_visual(
            {
                "phase": "split_product_visual",
                "product_visual_plan": {"image_types": [{"schemes": [{}]}]},
            }
        )
        == "split_product_visual"
    )


def test_route_after_image_qa_check_seed_error_goes_done():
    assert route_after_image_qa_check({"phase": "error", "image_qa_result": "pass"}) == "done"
    assert route_after_image_qa_check({"phase": "error", "image_qa_result": "remediated"}) == "done"


def test_route_after_image_qa_remedy_seed_error_goes_done():
    assert (
        route_after_image_qa_remedy({"phase": "error", "image_qa_decision": "ai_white_bg"})
        == "done"
    )


@pytest.mark.asyncio
async def test_image_qa_check_seed_failure_routes_done_not_plan_stub():
    node = make_image_qa_check_node(nest=None)
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.9, "has_white_bg": True}
            ],
        }
    )
    assert out["phase"] == "error"
    assert out["image_qa_result"] == "pass"
    assert route_after_image_qa_check(out) == "done"


@pytest.mark.asyncio
async def test_image_qa_remedy_seed_failure_routes_done_not_plan_stub():
    remedy = make_image_qa_remedy_node(nest=object())
    out = await remedy(
        {
            "image_qa_decision": "ai_white_bg",
            "sidebar_attachments": [{"mediaType": "image", "role": "product", "url": "u1"}],
        }
    )
    assert out["phase"] == "error"
    assert route_after_image_qa_remedy(out) == "done"


def test_product_visual_gate_subgraph_compiles():
    from app.graph.nodes.await_topo import make_await_topo_node
    from app.graph.nodes.done import make_done_node

    class _LLM:
        async def ainvoke(self, _messages: Any) -> Any:
            class _R:
                content = '{"visual_intent":{"primary_goal":"generic","confidence":0.5},"image_types":[{"type_id":"hero_main","type_label":"主图","schemes":[{"scheme_id":"c1","prompt":"x"}]}]}'

            return _R()

    async def _start_gen(_state: dict) -> dict:
        return {"phase": "orchestrate_gen"}

    graph = StateGraph(AgentRuntimeState)
    graph.add_node("done", make_done_node())
    graph.add_node("await_topo", make_await_topo_node())
    graph.add_node("start_gen", _start_gen)
    register_product_visual_gate(graph, llm=_LLM())
    graph.add_edge(START, "image_qa_check")
    graph.add_edge("await_topo", END)
    graph.add_edge("done", END)
    compiled = graph.compile(
        interrupt_before=["await_image_qa", "await_scheme_select", "await_delivery_confirm"],
    )
    assert compiled is not None
