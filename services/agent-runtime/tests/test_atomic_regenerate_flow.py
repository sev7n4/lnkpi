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
