"""Phase 1 seed chain tests."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.phase1_seed import _batch_items, ensure_phase1_seed_chain


def test_product_turnaround_batch_has_no_character_pipeline():
    items = _batch_items(
        [
            {
                "key": "product_turnaround",
                "title": "产品四视图",
                "target_type": "image",
                "prompt_hint": "同一产品四格拼图",
            }
        ]
    )
    assert len(items) == 1
    assert "pipeline" not in items[0]
    assert items[0]["imageAspect"] == "2:1"


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [
                {"key": item["key"], "nodeId": f"node-{item['key']}"} for item in items
            ],
            "actions": [],
        }

    async def connect_nodes(self, edges: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        return {"actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str], **kwargs: Any) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}


@pytest.mark.asyncio
async def test_ensure_phase1_seed_creates_nodes_without_turnaround_pipeline():
    nest = FakeNest()
    manifest, err = await ensure_phase1_seed_chain(nest, {}, run_generation=False)
    assert err is None
    batch_call = next(c for c in nest.calls if c[0] == "add_nodes_batch")
    items = batch_call[1]
    ta = next(it for it in items if it["key"] == "product_turnaround")
    assert "pipeline" not in ta
    assert ta.get("imageAspect") == "2:1"
    assert {it["key"] for it in manifest} == {"white_bg", "product_turnaround"}
