"""product_visual Phase 3 dynamic split tests (Task 5)."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.split_product_visual import (
    build_manifest_from_plan,
    make_split_product_visual_node,
)
from app.graph.product_visual_prompt import build_scheme_prompt_hint

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


def test_manifest_keys_are_type_scheme():
    items = build_manifest_from_plan(PLAN)
    keys = {i["key"] for i in items}
    assert keys == {"hero_main__c1", "packaging_hero__c1", "packaging_hero__c2"}


def test_all_items_target_type_image():
    items = build_manifest_from_plan(PLAN)
    assert all(i["target_type"] == "image" for i in items)


def test_depends_on_phase1_assets():
    items = build_manifest_from_plan(PLAN)
    for item in items:
        assert "white_bg" in item["depends_on"]
        assert "product_turnaround" in item["depends_on"]


def test_scheme_prompt_hints_differ_per_scheme():
    hints = {
        i["key"]: i["prompt_hint"]
        for i in build_manifest_from_plan(PLAN)
        if i["key"].startswith("packaging_hero")
    }
    assert hints["packaging_hero__c1"] != hints["packaging_hero__c2"]


def test_build_scheme_prompt_hint_includes_intent():
    hint = build_scheme_prompt_hint(
        {"scheme_id": "c1", "prompt": "主图", "key_elements": {"selling_points": ["316钢"]}},
        {"style_hints": ["高级"], "user_stated_constraints": ["白底"]},
    )
    assert "主图" in hint
    assert "316钢" in hint
    assert "高级" in hint
    assert "白底" in hint


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, str]:
        self.calls.append(("upsert_prompt_node", kwargs))
        return {"nodeId": "plan-visual-1"}

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [
                {"key": it["key"], "nodeId": f"node-{it['key']}"}
                for it in items
            ]
        }

    async def connect_nodes(self, edges: list[dict[str, str]]) -> None:
        self.calls.append(("connect_nodes", edges))

    async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> None:
        self.calls.append(("set_node_prompt", (node_id, prompt)))

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> None:
        self.calls.append(("attach_refs", (node_id, ref_order)))


@pytest.mark.asyncio
async def test_split_node_merges_phase1_and_routes_await_topo():
    from pathlib import Path

    skills_dir = Path(__file__).resolve().parents[1] / "skills"
    nest = FakeNest()
    node = make_split_product_visual_node(nest=nest, skills_dir=skills_dir)
    out = await node(
        {
            "product_visual_plan": PLAN,
            "split_manifest": [
                {"key": "white_bg", "node_id": "existing-wb", "target_type": "image"},
                {"key": "product_turnaround", "node_id": "existing-ta", "target_type": "image"},
            ],
        }
    )
    assert out["phase"] == "await_topo"
    assert out.get("plan_node_id") == "plan-visual-1"
    keys = {it["key"] for it in out["split_manifest"]}
    assert "white_bg" in keys
    assert "product_turnaround" in keys
    assert "hero_main__c1" in keys
    batch_calls = [c for c in nest.calls if c[0] == "add_nodes_batch"]
    assert batch_calls
    created_keys = {it["key"] for it in batch_calls[0][1]}
    assert "white_bg" not in created_keys
    assert "product_turnaround" not in created_keys
    assert "hero_main__c1" in created_keys
    assert out.get("gen_ordered_keys")
