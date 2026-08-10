"""collect_gen helpers — product_visual gen_by_key URL enrich."""

from __future__ import annotations

import pytest

from app.graph.nodes.collect_gen import _enrich_gen_by_key_urls, make_collect_gen_node


class _NestWithGetNode:
    def __init__(self, nodes: dict[str, dict] | None = None) -> None:
        self.nodes = nodes or {}
        self.save_calls: list[dict] = []

    async def get_node(self, node_id: str) -> dict:
        if node_id not in self.nodes:
            raise KeyError(node_id)
        return self.nodes[node_id]

    async def save_gen_progress(self, **payload: object) -> dict:
        self.save_calls.append(payload)
        return {"id": "gp-1"}


@pytest.mark.asyncio
async def test_enrich_gen_by_key_urls_fills_missing_url():
    nest = _NestWithGetNode({"node-a": {"data": {"url": "https://cdn/a.png"}}})
    by_key = {"hero__c1": {"node_id": "node-a", "title": "主图"}}
    out = await _enrich_gen_by_key_urls(nest, by_key, {"hero__c1"})
    assert out["hero__c1"]["url"] == "https://cdn/a.png"
    assert out["hero__c1"]["status"] == "completed"


@pytest.mark.asyncio
async def test_enrich_gen_by_key_skips_existing_url():
    nest = _NestWithGetNode({"node-a": {"data": {"url": "https://cdn/other.png"}}})
    by_key = {"hero__c1": {"node_id": "node-a", "url": "https://cdn/existing.png"}}
    out = await _enrich_gen_by_key_urls(nest, by_key, {"hero__c1"})
    assert out["hero__c1"]["url"] == "https://cdn/existing.png"


@pytest.mark.asyncio
async def test_collect_gen_product_visual_returns_enriched_gen_by_key():
    nest = _NestWithGetNode({"node-k": {"url": "https://cdn/k.png"}})
    node = make_collect_gen_node(nest=nest)
    state = {
        "flow_mode": "product_visual",
        "gen_by_key": {"k": {"node_id": "node-k", "title": "主图"}},
        "gen_completed_keys": ["k"],
        "gen_failed_keys": [],
        "gen_needs_user_keys": [],
        "gen_fail_details": {},
        "thread_id": "t1",
        "session_id": "s1",
    }
    out = await node(state)
    assert out["gen_by_key"]["k"]["url"] == "https://cdn/k.png"
    assert out.get("gen_deps_of") is None
