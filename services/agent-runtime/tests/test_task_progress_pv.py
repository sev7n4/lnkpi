"""UX-PV-07: product_visual generation task_list / task_progress_card."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.task_events import build_task_list_items


def test_build_task_list_items_uses_chinese_titles():
    manifest = [
        {"key": "white_bg", "title": "白底主图", "node_id": "n-wb", "target_type": "image"},
        {"key": "packaging_hero__1", "title": "礼盒主视觉", "node_id": "n-ph", "target_type": "image"},
        {"key": "gift_scene__1", "title": "送礼场景", "node_id": "n-gift", "target_type": "image"},
    ]
    items = build_task_list_items(manifest, ["white_bg", "packaging_hero__1", "gift_scene__1"])
    assert [it["title"] for it in items] == ["白底主图", "礼盒主视觉", "送礼场景"]
    assert items[1]["id"] == "packaging_hero__1"
    assert items[1]["nodeId"] == "n-ph"


class TaskListNest:
    def __init__(self) -> None:
        self.task_list_calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []

    async def emit_task_list(self, items: list[dict[str, Any]], **meta: Any) -> None:
        self.task_list_calls.append((items, meta))


@pytest.mark.asyncio
async def test_start_gen_emits_task_list_with_banner_for_product_visual_v2():
    nest = TaskListNest()
    node = make_start_gen_node(nest=nest)
    await node(
        {
            "flow_mode": "product_visual",
            "product_visual_scheme_v2": True,
            "split_manifest": [
                {
                    "key": "white_bg",
                    "title": "白底主图",
                    "node_id": "n-wb",
                    "target_type": "image",
                    "auto_generate": True,
                    "depends_on": [],
                },
                {
                    "key": "packaging_hero__1",
                    "title": "礼盒主视觉",
                    "node_id": "n-ph",
                    "target_type": "image",
                    "auto_generate": True,
                    "depends_on": ["white_bg"],
                },
            ],
            "gen_ordered_keys": ["white_bg", "packaging_hero__1"],
            "plan_node_id": "plan-1",
        }
    )
    assert len(nest.task_list_calls) == 1
    items, meta = nest.task_list_calls[0]
    assert [it["title"] for it in items] == ["白底主图", "礼盒主视觉"]
    assert "切换标签" in meta.get("banner", "")
