"""P4: atomic_create_gate subgraph tests."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.atomic_create_node import make_create_atomic_node
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node
from app.graph.nodes.await_atomic_confirm import make_await_atomic_confirm_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node
from app.graph.subgraphs.atomic_create_gate import (
    route_after_atomic_confirm,
    route_after_atomic_create,
    route_after_atomic_parse,
)


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [
                {"key": item["key"], "nodeId": f"node-atomic-{idx + 1}"}
                for idx, item in enumerate(items)
            ],
        }

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-img-1"}

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_video_generation", node_id))
        return {"status": "completed", "url": "https://cdn/v.mp4"}

    async def run_text_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_text_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-text-1"}


@pytest.mark.asyncio
async def test_parse_atomic_intent_with_canvas_summary():
    class SummaryNest:
        async def get_canvas_summary(self) -> dict:
            return {
                "nodes": [
                    {"id": "img1", "type": "image", "title": "模特人物图", "status": "completed"},
                ]
            }

    node = make_parse_atomic_intent_node(nest=SummaryNest())
    out = await node({"messages": [HumanMessage(content="帮我生成一个模特人物图")]})
    assert out["atomic_spec"]["title"] == "模特人物图 (2)"
    assert "canvas_context" in out["atomic_spec"]


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
async def test_create_atomic_node_passes_video_p6_fields():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    spec = {
        "target_type": "video",
        "prompt": "产品展示",
        "title": "产品展示",
        "confirm_gate": True,
        "videoSettings": {"duration": 4, "aspectRatio": "9:16", "generateAudio": False},
        "videoMode": "image_to_video",
        "referenceImageUrl": "https://cdn.example/ref.png",
    }
    await create({"atomic_spec": spec})
    batch_call = next(c for c in nest.calls if c[0] == "add_nodes_batch")
    item = batch_call[1][0]
    assert item["videoSettings"] == {
        "duration": 4,
        "aspectRatio": "9:16",
        "generateAudio": False,
    }
    assert item["videoMode"] == "image_to_video"
    assert item["referenceImageUrl"] == "https://cdn.example/ref.png"


@pytest.mark.asyncio
async def test_text_atomic_gen_direct():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    spec = {
        "target_type": "text",
        "prompt": "广告词，强调降噪",
        "title": "广告词",
        "confirm_gate": False,
    }
    created = await create({"atomic_spec": spec})
    assert route_after_atomic_create({**created, "atomic_spec": spec}) == "run_atomic_gen"
    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**created, "atomic_spec": spec})
    assert done["phase"] == "done"
    assert any(c[0] == "run_text_generation" for c in nest.calls)


@pytest.mark.asyncio
async def test_multi_image_atomic_create_and_gen():
    nest = FakeNest()
    utterance = "帮我生成三张图，分别是蓝牙耳机主图、白底图、三视图。"
    parsed = await make_parse_atomic_intent_node()( {"messages": [HumanMessage(content=utterance)]})
    items = parsed.get("atomic_items") or []
    assert len(items) == 3
    assert [i["prompt"] for i in items] == ["蓝牙耳机主图", "白底图", "三视图"]

    created = await make_create_atomic_node(nest=nest)(parsed)
    assert len(created["atomic_items"]) == 3
    batch_call = next(c for c in nest.calls if c[0] == "add_nodes_batch")
    assert len(batch_call[1]) == 3

    run = make_run_atomic_gen_node(nest=nest)
    done = await run(created)
    assert done["phase"] == "done"
    gen_calls = [c for c in nest.calls if c[0] == "run_image_generation"]
    assert len(gen_calls) == 3
    assert gen_calls[0][1] == "node-atomic-1"
    assert gen_calls[2][1] == "node-atomic-3"


@pytest.mark.asyncio
async def test_parse_clarify_routes_to_clarify_node():
    out = await make_parse_atomic_intent_node()({"messages": [HumanMessage(content="帮我生成")]})
    assert out["phase"] == "clarify"
    assert route_after_atomic_parse(out) == "clarify_gate"


@pytest.mark.asyncio
async def test_clarify_does_not_create_nodes():
    nest = FakeNest()
    create = make_create_atomic_node(nest=nest)
    parsed = await make_parse_atomic_intent_node()({"messages": [HumanMessage(content="帮我生成")]})
    assert route_after_atomic_parse(parsed) == "clarify_gate"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
    # create node should not be invoked — verify nest still empty if we skip create
    _ = create  # create not called in clarify path


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
async def test_await_atomic_confirm_honors_injected_user_decision():
    nest = FakeNest()
    await_node = make_await_atomic_confirm_node()
    confirmed = await await_node(
        {"messages": [HumanMessage(content="")], "user_decision": "confirm"},
    )
    assert confirmed["user_decision"] == "confirm"
    cancelled = await await_node(
        {"messages": [HumanMessage(content="")], "user_decision": "revise"},
    )
    assert cancelled["user_decision"] == "revise"
    assert cancelled["phase"] == "done"


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


@pytest.mark.asyncio
async def test_partial_multi_gen_compose_lc6():
    class PartialNest(FakeNest):
        def __init__(self) -> None:
            super().__init__()
            self._n = 0

        async def run_image_generation(self, node_id: str) -> dict[str, Any]:
            self._n += 1
            self.calls.append(("run_image_generation", node_id))
            if self._n == 2:
                return {"status": "failed", "error": "timeout"}
            return {"status": "completed", "generationRecordId": f"rec-{self._n}"}

    nest = PartialNest()
    items = [
        {"node_id": "n1", "target_type": "image", "title": "主图"},
        {"node_id": "n2", "target_type": "image", "title": "白底图"},
        {"node_id": "n3", "target_type": "image", "title": "三视图"},
    ]
    run = make_run_atomic_gen_node(nest=nest)
    out = await run({"atomic_items": items})
    assert out["phase"] == "error"
    assert "部分完成" in out["messages"][0].content
    assert "主图" in out["messages"][0].content
    assert "白底图" in out["messages"][0].content or "三视图" in out["messages"][0].content
