"""Tests for Phase C canvas sync in start_gen."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.start_gen import make_start_gen_node


class SummaryNest:
    async def get_canvas_summary(self) -> dict[str, Any]:
        return {
            "nodes": [
                {"id": "img-1", "type": "image", "title": "主图", "status": "idle"},
                {"id": "img-new", "type": "image", "title": "场景图", "status": "idle"},
            ]
        }


@pytest.mark.asyncio
async def test_start_gen_syncs_manifest_from_canvas():
    node = make_start_gen_node(nest=SummaryNest())
    out = await node(
        {
            "split_manifest": [
                {
                    "key": "hero_main",
                    "title": "主图",
                    "node_id": "img-1",
                    "target_type": "image",
                    "auto_generate": True,
                    "depends_on": [],
                }
            ],
            "plan_node_id": "plan-1",
        }
    )
    keys = {str(it["key"]) for it in out.get("split_manifest") or []}
    assert len(keys) == 2
    assert out.get("gen_ordered_keys")
    assert "画布已同步" in out["messages"][0].content
