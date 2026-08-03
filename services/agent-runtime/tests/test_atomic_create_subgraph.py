"""P4: atomic_create_gate subgraph tests."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.atomic_create_node import make_create_atomic_node
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node
from app.graph.nodes.await_atomic_confirm import make_await_atomic_confirm_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node
from app.graph.subgraphs.atomic_create_gate import route_after_atomic_confirm, route_after_atomic_create


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {"nodes": [{"key": items[0]["key"], "nodeId": "node-atomic-1"}]}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-img-1"}

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_video_generation", node_id))
        return {"status": "completed", "url": "https://cdn/v.mp4"}


@pytest.mark.asyncio
async def test_parse_atomic_intent_image():
    node = make_parse_atomic_intent_node()
    out = await node({"messages": [HumanMessage(content="帮我生成一个模特人物图")]})
    assert out["flow_mode"] == "atomic_create"
    assert out["atomic_spec"]["target_type"] == "image"
    assert out["atomic_spec"]["confirm_gate"] is False


@pytest.mark.asyncio
async def test_create_atomic_node_then_image_gen():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    spec = {
        "target_type": "image",
        "prompt": "模特人物图",
        "title": "模特人物图",
        "confirm_gate": False,
    }
    created = await create({"atomic_spec": spec})
    assert created["atomic_node_id"] == "node-atomic-1"
    assert route_after_atomic_create({**created, "atomic_spec": spec}) == "run_atomic_gen"

    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**created, "atomic_spec": spec})
    assert done["phase"] == "done"
    assert any(c[0] == "run_image_generation" for c in nest.calls)


@pytest.mark.asyncio
async def test_video_routes_to_confirm_gate():
    spec = {
        "target_type": "video",
        "prompt": "15秒产品展示视频",
        "title": "视频",
        "confirm_gate": True,
    }
    assert route_after_atomic_create({"atomic_spec": spec, "atomic_node_id": "v1"}) == "await_atomic_confirm"


@pytest.mark.asyncio
async def test_await_atomic_confirm_then_gen():
    nest = FakeNest()
    await_node = make_await_atomic_confirm_node()
    pending = await await_node({"messages": [HumanMessage(content="")]})
    assert pending["user_decision"] == "none"

    confirmed = await await_node({"messages": [HumanMessage(content="确认生成")]})
    assert confirmed["user_decision"] == "confirm"
    assert route_after_atomic_confirm(confirmed) == "run_atomic_gen"

    run = make_run_atomic_gen_node(nest=nest)
    spec = {"target_type": "video", "title": "视频", "confirm_gate": True}
    out = await run({"atomic_node_id": "node-atomic-1", "atomic_spec": spec})
    assert out["phase"] == "done"
    assert any(c[0] == "run_video_generation" for c in nest.calls)
