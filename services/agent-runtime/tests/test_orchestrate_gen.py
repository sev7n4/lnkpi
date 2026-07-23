"""Tests for orchestrate_gen: topo order, concurrency, skip on dep failure."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node


class FakeNest:
    def __init__(self, *, fail_keys: set[str] | None = None) -> None:
        self.fail_keys = fail_keys or set()
        self.calls: list[str] = []
        self.key_by_node: dict[str, str] = {}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        key = self.key_by_node.get(node_id, node_id)
        self.calls.append(key)
        if key in self.fail_keys:
            raise RuntimeError(f"gen failed: {key}")
        return {"nodeId": node_id, "status": "completed"}


def _manifest(*pairs: tuple[str, list[str]]) -> list[dict[str, Any]]:
    """Build image auto_generate manifest; node_id = node-{key}."""
    items = []
    for key, deps in pairs:
        items.append(
            {
                "key": key,
                "target_type": "image",
                "auto_generate": True,
                "depends_on": deps,
                "node_id": f"node-{key}",
            }
        )
    return items


@pytest.mark.asyncio
async def test_orchestrate_white_bg_success_then_hero_called():
    nest = FakeNest()
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(
        ("hero_main", ["white_bg"]),
        ("white_bg", []),
    )
    # video must be ignored even if present
    manifest.append(
        {
            "key": "show_video",
            "target_type": "video",
            "auto_generate": False,
            "depends_on": ["hero_main"],
            "node_id": "node-show_video",
        }
    )

    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )

    assert nest.calls == ["white_bg", "hero_main"]
    assert result["gen_completed"] == ["node-white_bg", "node-hero_main"]
    assert result["gen_failed"] == []
    assert result["gen_queue"] == ["node-white_bg", "node-hero_main"]
    assert result["phase"] == "orchestrate_gen"
    assert any(isinstance(m, AIMessage) for m in result["messages"])


@pytest.mark.asyncio
async def test_orchestrate_white_bg_fail_skips_hero():
    nest = FakeNest(fail_keys={"white_bg"})
    nest.key_by_node = {"node-white_bg": "white_bg", "node-hero_main": "hero_main"}
    node = make_orchestrate_gen_node(nest=nest)
    manifest = _manifest(
        ("hero_main", ["white_bg"]),
        ("white_bg", []),
    )

    result = await node(
        {
            "split_manifest": manifest,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [],
        }
    )

    assert nest.calls == ["white_bg"]
    assert "hero_main" not in nest.calls
    assert result["gen_completed"] == []
    by_key = {f["key"]: f for f in result["gen_failed"]}
    assert "white_bg" in by_key
    assert by_key["hero_main"]["reason"] == "dependency_failed"
