"""product_visual Gen path verification (Task 6) — AC-6, AC-14, scheduler integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.split_product_visual import (
    build_manifest_from_plan,
    make_split_product_visual_node,
)
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.state import AgentRuntimeState

PLAN = {
    "visual_intent": {"primary_goal": "mixed", "style_hints": ["简约"], "user_stated_constraints": ["白底"]},
    "image_types": [
        {
            "type_id": "hero_main",
            "type_label": "主图",
            "selected_scheme_ids": ["c1"],
            "schemes": [{"scheme_id": "c1", "recommended": True, "prompt": "白底主图"}],
        },
        {
            "type_id": "packaging_hero",
            "type_label": "包装",
            "selected_scheme_ids": ["c1", "c2"],
            "schemes": [
                {"scheme_id": "c1", "prompt": "A"},
                {"scheme_id": "c2", "prompt": "B"},
            ],
        },
    ],
}


def _phase1_items() -> list[dict[str, Any]]:
    return [
        {
            "key": "white_bg",
            "node_id": "n-wb",
            "target_type": "image",
            "auto_generate": True,
            "depends_on": [],
            "title": "白底主图",
        },
        {
            "key": "product_turnaround",
            "node_id": "n-ta",
            "target_type": "image",
            "auto_generate": True,
            "depends_on": ["white_bg"],
            "title": "产品四视图",
        },
    ]


@pytest.fixture
def product_visual_manifest() -> list[dict[str, Any]]:
    """Full manifest after split (Phase 1 + downstream schemes)."""
    downstream = build_manifest_from_plan(PLAN)
    for item in downstream:
        item["node_id"] = f"node-{item['key']}"
    return [*_phase1_items(), *downstream]


def _dispatched_keys(cmd) -> list[str]:
    return [s.arg["key"] for s in cmd.goto if isinstance(s, Send)]


def test_ac6_same_type_schemes_have_distinct_prompt_hints(product_visual_manifest):
    hints = {
        i["key"]: i["prompt_hint"]
        for i in product_visual_manifest
        if i["key"].startswith("packaging_hero")
    }
    assert set(hints) == {"packaging_hero__c1", "packaging_hero__c2"}
    assert hints["packaging_hero__c1"] != hints["packaging_hero__c2"]


def test_ac6_parallel_gen_keys_share_deps(product_visual_manifest):
    """Both packaging schemes sit in the same topo wave after Phase 1 completes."""
    from app.graph.topo import topo_sort_gen_keys

    ordered = topo_sort_gen_keys(product_visual_manifest)
    parallel = {"packaging_hero__c1", "packaging_hero__c2"}
    assert parallel.issubset(set(ordered))
    ta_idx = ordered.index("product_turnaround")
    assert ordered.index("packaging_hero__c1") > ta_idx
    assert ordered.index("packaging_hero__c2") > ta_idx


def test_ac14_manifest_has_no_video_targets(product_visual_manifest):
    assert all(i.get("target_type") != "video" for i in product_visual_manifest)
    assert all(i.get("target_type") == "image" for i in product_visual_manifest)


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, str]:
        self.calls.append(("upsert_prompt_node", kwargs))
        return {"nodeId": "plan-visual-1"}

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [{"key": it["key"], "nodeId": f"node-{it['key']}"} for it in items]
        }

    async def connect_nodes(self, edges: list[dict[str, str]]) -> None:
        self.calls.append(("connect_nodes", edges))

    async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> None:
        self.calls.append(("set_node_prompt", (node_id, prompt)))

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> None:
        self.calls.append(("attach_refs", (node_id, ref_order)))


class GenNest:
    """Minimal nest for gen subgraph integration (mirrors test_gen_subgraph._Nest)."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def emit_task_update(self, **payload: Any) -> None:
        pass

    async def emit_task_summary(self, **payload: Any) -> None:
        pass

    async def emit_text(self, text: str) -> None:
        pass

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def start_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(node_id)
        return {"nodeId": node_id, "status": "completed", "generationRecordId": f"rec-{node_id}"}

    async def wait_image_generation(self, node_id: str, record_id: str) -> dict[str, Any]:
        return {"nodeId": node_id, "status": "completed", "generationRecordId": record_id}

    async def save_gen_progress(self, **kwargs: Any) -> dict[str, Any]:
        return {"id": "gp-pv-1"}

    async def get_gen_progress(self, thread_id: str) -> dict[str, Any]:
        return {"id": "gp-pv-1", "lines": "[]", "summary": None}


def _build_gen_subgraph(nest: GenNest, *, max_concurrency: int = 3):
    g = StateGraph(AgentRuntimeState)
    g.add_node("start_gen", make_start_gen_node())
    g.add_node("gen_scheduler", make_gen_scheduler_node(max_concurrency=max_concurrency))
    g.add_node("gen_node", make_gen_node(nest=nest))
    g.add_edge(START, "start_gen")
    g.add_edge("start_gen", "gen_scheduler")
    g.add_edge("gen_node", "gen_scheduler")
    return g.compile(checkpointer=MemorySaver())


@pytest.mark.asyncio
async def test_start_gen_initializes_gen_by_key_from_split_manifest(product_visual_manifest):
    start_gen = make_start_gen_node()
    out = await start_gen(
        {
            "flow_mode": "product_visual",
            "split_manifest": product_visual_manifest,
            "gen_ordered_keys": [i["key"] for i in product_visual_manifest],
            "plan_node_id": "plan-visual-1",
        }
    )
    by_key = out["gen_by_key"]
    assert set(by_key) == {i["key"] for i in product_visual_manifest}
    hints = {k: by_key[k]["prompt_hint"] for k in ("packaging_hero__c1", "packaging_hero__c2")}
    assert hints["packaging_hero__c1"] != hints["packaging_hero__c2"]
    assert all(by_key[k]["target_type"] == "image" for k in by_key)


@pytest.mark.asyncio
async def test_gen_scheduler_dispatches_parallel_packaging_schemes(product_visual_manifest):
    """After Phase 1 completes, scheduler fans out both packaging schemes in one wave."""
    start_gen = make_start_gen_node()
    sched = make_gen_scheduler_node(max_concurrency=3)
    started = await start_gen(
        {
            "flow_mode": "product_visual",
            "split_manifest": product_visual_manifest,
            "gen_ordered_keys": [i["key"] for i in product_visual_manifest],
            "plan_node_id": "plan-visual-1",
        }
    )
    cmd = await sched(
        {
            **started,
            "gen_completed_keys": ["white_bg", "product_turnaround"],
        }
    )
    dispatched = sorted(_dispatched_keys(cmd))
    assert dispatched == ["hero_main__c1", "packaging_hero__c1", "packaging_hero__c2"]


@pytest.mark.asyncio
async def test_product_visual_split_to_gen_scheduler_integration():
    """split_product_visual → start_gen → gen_scheduler (mock nest, no gen_node)."""
    skills_dir = Path(__file__).resolve().parents[1] / "skills"
    split_node = make_split_product_visual_node(nest=FakeNest(), skills_dir=skills_dir)
    split_out = await split_node(
        {
            "product_visual_plan": PLAN,
            "split_manifest": [
                {"key": "white_bg", "node_id": "n-wb", "target_type": "image"},
                {"key": "product_turnaround", "node_id": "n-ta", "target_type": "image"},
            ],
        }
    )
    assert split_out["phase"] == "await_topo"
    assert split_out.get("gen_ordered_keys")

    start_gen = make_start_gen_node()
    sched = make_gen_scheduler_node(max_concurrency=3)
    started = await start_gen({**split_out, "flow_mode": "product_visual"})
    assert started["gen_by_key"]
    assert all(
        started["gen_by_key"][k]["target_type"] == "image"
        for k in started["gen_by_key"]
    )

    wave1 = await sched(started)
    assert _dispatched_keys(wave1) == ["white_bg"]

    wave2 = await sched({**started, "gen_completed_keys": ["white_bg"]})
    assert _dispatched_keys(wave2) == ["product_turnaround"]

    wave3 = await sched({**started, "gen_completed_keys": ["white_bg", "product_turnaround"]})
    parallel = sorted(_dispatched_keys(wave3))
    assert parallel == ["hero_main__c1", "packaging_hero__c1", "packaging_hero__c2"]
    hints = {
        k: started["gen_by_key"][k]["prompt_hint"]
        for k in ("packaging_hero__c1", "packaging_hero__c2")
    }
    assert hints["packaging_hero__c1"] != hints["packaging_hero__c2"]


@pytest.mark.asyncio
async def test_product_visual_gen_subgraph_completes_without_video_keys():
    """End-to-end subgraph: all image keys complete; nest never sees video generation."""
    nest = GenNest()
    graph = _build_gen_subgraph(nest, max_concurrency=3)
    downstream = build_manifest_from_plan(PLAN)
    for item in downstream:
        item["node_id"] = f"node-{item['key']}"
    manifest = [*_phase1_items(), *downstream]

    result = await graph.ainvoke(
        {
            "flow_mode": "product_visual",
            "split_manifest": manifest,
            "gen_ordered_keys": [i["key"] for i in manifest],
            "plan_node_id": "plan-visual-1",
            "thread_id": "pv-gen",
            "session_id": "s-pv-gen",
        },
        {"configurable": {"thread_id": "pv-gen"}, "recursion_limit": 100},
    )
    assert all(i.get("target_type") == "image" for i in manifest)
    assert len(nest.calls) == len(manifest)
    assert result.get("gen_completed_keys") is not None or result.get("phase") == "done"
