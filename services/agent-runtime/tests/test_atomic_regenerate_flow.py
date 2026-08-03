from __future__ import annotations

from typing import Any

import pytest

from app.graph.builder import route_after_intake
from app.graph.nodes.prepare_atomic_regenerate import make_prepare_atomic_regenerate_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def get_node(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("get_node", node_id))
        return {"id": node_id, "type": "image", "title": "模特图"}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-regen-1"}


def test_route_after_intake_regenerate():
    assert route_after_intake({"flow_mode": "atomic_regenerate"}) == "prepare_atomic_regenerate"


@pytest.mark.asyncio
async def test_prepare_then_regenerate_skips_create():
    nest = FakeNest()
    spec = {"target_type": "image", "title": "模特图", "prompt": "模特人物图", "confirm_gate": False}
    state = {"atomic_node_id": "node-abc", "atomic_spec": spec, "last_error": "tool_timeout"}

    prep = make_prepare_atomic_regenerate_node(nest=nest)
    prepped = await prep(state)
    assert prepped["last_error"] is None
    assert "重新生成" in prepped["messages"][0].content

    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**state, **prepped})
    assert done["phase"] == "done"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
    assert ("run_image_generation", "node-abc") in nest.calls


@pytest.mark.asyncio
async def test_video_regenerate_skips_confirm_gate():
    class VideoNest(FakeNest):
        async def run_video_generation(self, node_id: str) -> dict[str, Any]:
            self.calls.append(("run_video_generation", node_id))
            return {"status": "completed", "url": "https://cdn/v2.mp4"}

    nest = VideoNest()
    spec = {
        "target_type": "video",
        "title": "产品视频",
        "prompt": "15秒展示",
        "confirm_gate": True,
    }
    prep = make_prepare_atomic_regenerate_node(nest=nest)
    prepped = await prep({"atomic_node_id": "vid-1", "atomic_spec": spec})
    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**prepped, "atomic_node_id": "vid-1", "atomic_spec": spec})
    assert done["phase"] == "done"
    assert ("run_video_generation", "vid-1") in nest.calls
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)


@pytest.mark.asyncio
async def test_audio_regenerate_skips_confirm_gate():
    class AudioNest(FakeNest):
        async def run_audio_generation(self, node_id: str) -> dict[str, Any]:
            self.calls.append(("run_audio_generation", node_id))
            return {"status": "completed", "url": "https://cdn/v2.mp3"}

    nest = AudioNest()
    spec = {
        "target_type": "audio",
        "title": "产品配音",
        "prompt": "15秒旁白",
        "confirm_gate": True,
    }
    prep = make_prepare_atomic_regenerate_node(nest=nest)
    prepped = await prep({"atomic_node_id": "aud-1", "atomic_spec": spec})
    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**prepped, "atomic_node_id": "aud-1", "atomic_spec": spec})
    assert done["phase"] == "done"
    assert ("run_audio_generation", "aud-1") in nest.calls
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
