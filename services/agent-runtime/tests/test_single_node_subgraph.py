"""W29: single_node_gate subgraph tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.subgraphs.single_node_gate import manifest_item_from_canvas_node


def test_manifest_item_from_canvas_node():
    item = manifest_item_from_canvas_node(
        {
            "id": "image-1234567890",
            "type": "image",
            "title": "主图",
            "data": {"prompt": "白底产品图"},
        }
    )
    assert item is not None
    assert item["node_id"] == "image-1234567890"
    assert item["target_type"] == "image"
    assert item["prompt_hint"] == "白底产品图"


@pytest.mark.asyncio
async def test_intake_routes_single_node_without_plan(tmp_path):
    from pathlib import Path

    from langchain_core.messages import HumanMessage

    from app.graph.nodes.intake import make_intake_node

    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake(
        {
            "messages": [HumanMessage(content="快速生成这张主图")],
            "focus_node_id": "image-abc",
        }
    )
    assert out.get("flow_mode") == "single_node"
    assert out.get("focus_node_id") == "image-abc"


@pytest.mark.asyncio
async def test_prepare_single_gen_builds_manifest():
    """prepare_single_gen resolves focus node → manifest without plan/split."""

    class FakeNest:
        async def get_node(self, node_id: str) -> dict:
            return {
                "id": node_id,
                "type": "image",
                "title": "主图",
                "data": {"prompt": "test prompt"},
            }

    from app.graph.subgraphs.single_node_gate import make_prepare_single_gen_node

    node_fn = make_prepare_single_gen_node(nest=FakeNest())
    out = await node_fn({"focus_node_id": "image-abc"})
    assert out.get("phase") == "orchestrate_gen"
    assert out.get("flow_mode") == "single_node"
    assert out.get("user_decision") == "confirm_gen"
    manifest = out.get("split_manifest") or []
    assert len(manifest) == 1
    assert manifest[0]["node_id"] == "image-abc"
    assert manifest[0]["target_type"] == "image"
    assert "单节点快速生成" in out["messages"][0].content
