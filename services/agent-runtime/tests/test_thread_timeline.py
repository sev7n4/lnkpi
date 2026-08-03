"""W27: Graph phase timeline from checkpoint history."""

from __future__ import annotations

import pytest

from app.replay import get_thread_timeline


class _Snap:
    def __init__(self, *, values: dict, metadata: dict, next_nodes: list[str]):
        self.values = values
        self.metadata = metadata
        self.next = next_nodes


class _FakeGraph:
    def __init__(self, snaps: list[_Snap]):
        self._snaps = snaps

    async def aget_state_history(self, config, limit=100):  # noqa: ARG002
        for snap in self._snaps:
            yield snap


@pytest.mark.asyncio
async def test_timeline_collapses_same_phase():
    graph = _FakeGraph(
        [
            _Snap(values={"phase": "done"}, metadata={"step": 3}, next_nodes=[]),
            _Snap(values={"phase": "await_confirm"}, metadata={"step": 2}, next_nodes=["await_confirm"]),
            _Snap(values={"phase": "await_confirm"}, metadata={"step": 1}, next_nodes=["await_confirm"]),
            _Snap(values={"phase": "plan"}, metadata={"step": 0}, next_nodes=[]),
        ]
    )
    result = await get_thread_timeline("t1", graph=graph)
    assert result["threadId"] == "t1"
    assert result["checkpointCount"] == 4
    phases = [e["phase"] for e in result["entries"]]
    assert phases == ["plan", "await_confirm", "done"]


@pytest.mark.asyncio
async def test_timeline_includes_prompt_version():
    graph = _FakeGraph(
        [
            _Snap(
                values={"phase": "await_confirm", "skill_id": "enterprise-marketing-campaign", "prompt_version": "1.1.0"},
                metadata={"step": 1, "source": "loop"},
                next_nodes=["await_confirm"],
            ),
        ]
    )
    result = await get_thread_timeline("t2", graph=graph)
    assert result["entries"][0]["promptVersion"] == "1.1.0"
    assert result["entries"][0]["skillId"] == "enterprise-marketing-campaign"
