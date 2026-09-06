from __future__ import annotations

from typing import Any

import pytest
from langgraph.types import Command, Send

from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.run_cancel import clear_cancel, request_cancel


def _state(thread_id: str) -> dict[str, Any]:
    return {
        "thread_id": thread_id,
        "flow_mode": "product_visual",
        "gen_ordered_keys": ["a", "b"],
        "gen_deps_of": {"a": [], "b": ["a"]},
        "gen_by_key": {
            "a": {"node_id": "n1", "title": "A"},
            "b": {"node_id": "n2", "title": "B"},
        },
        "gen_completed_keys": [],
        "gen_failed_keys": [],
        "gen_needs_user_keys": [],
    }


@pytest.mark.asyncio
async def test_gen_scheduler_stops_dispatch_when_cancel_requested():
    tid = "t-sched-cancel"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    try:
        node = make_gen_scheduler_node(max_concurrency=4)
        cmd = await node(_state(tid))

        assert isinstance(cmd, Command)
        assert cmd.goto == ["collect_gen"]
        assert cmd.update.get("phase") == "cancelled"
        assert cmd.update.get("run_cancelled") is True
        assert not any(
            getattr(target, "node", None) == "gen_node"
            for target in (cmd.goto if isinstance(cmd.goto, list) else [])
        )
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_gen_scheduler_passes_thread_id_to_gen_node():
    tid = "t-sched-payload"
    node = make_gen_scheduler_node(max_concurrency=4)

    cmd = await node(_state(tid))

    sends = [target for target in cmd.goto if isinstance(target, Send)]
    assert sends
    assert sends[0].arg["thread_id"] == tid
    assert sends[0].arg["flow_mode"] == "product_visual"


@pytest.mark.asyncio
async def test_gen_scheduler_does_not_consume_cancel_for_campaign():
    tid = "t-sched-campaign-cancel"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    try:
        state = _state(tid)
        state["flow_mode"] = "campaign"
        node = make_gen_scheduler_node(max_concurrency=4)

        cmd = await node(state)

        sends = [target for target in cmd.goto if isinstance(target, Send)]
        assert [target.arg["key"] for target in sends] == ["a"]
        assert cmd.update.get("phase") != "cancelled"
    finally:
        clear_cancel(tid)


class _CancelNest:
    def __init__(self) -> None:
        self.cancelled_node_ids: list[str] = []
        self.generated_node_ids: list[str] = []

    async def cancel_generation(self, node_id: str) -> None:
        self.cancelled_node_ids.append(node_id)

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.generated_node_ids.append(node_id)
        return {"status": "completed"}


@pytest.mark.asyncio
async def test_gen_node_cancels_before_generation():
    tid = "t-node-cancel"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    nest = _CancelNest()
    try:
        node = make_gen_node(nest=nest)
        out = await node(
            {
                "thread_id": tid,
                "flow_mode": "product_visual",
                "key": "a",
                "gen_by_key": {"a": {"node_id": "n1", "title": "A"}},
            }
        )

        assert nest.cancelled_node_ids == ["n1"]
        assert nest.generated_node_ids == []
        assert out["gen_needs_user_keys"] == ["a"]
        assert out["gen_fail_details"]["a"]["reason"] == "cancelled"
    finally:
        clear_cancel(tid)


@pytest.mark.asyncio
async def test_gen_node_does_not_consume_cancel_for_campaign():
    tid = "t-node-campaign-cancel"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    nest = _CancelNest()
    try:
        node = make_gen_node(nest=nest)
        out = await node(
            {
                "thread_id": tid,
                "flow_mode": "campaign",
                "key": "a",
                "gen_by_key": {"a": {"node_id": "n1", "title": "A"}},
            }
        )

        assert nest.cancelled_node_ids == []
        assert nest.generated_node_ids == ["n1"]
        assert out["gen_completed_keys"] == ["a"]
    finally:
        clear_cancel(tid)
