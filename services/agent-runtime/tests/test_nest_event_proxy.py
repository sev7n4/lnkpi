"""NestEventProxy forwards P4 Harness modalities to inner client."""

from __future__ import annotations

import pytest

from app.runs import NestEventProxy


class FakeInner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def run_text_generation(self, node_id: str) -> dict:
        self.calls.append(("run_text_generation", node_id))
        return {
            "status": "completed",
            "generationRecordId": "rec-text-1",
            "actions": [{"type": "update_node", "payload": {"id": node_id}}],
        }


@pytest.mark.asyncio
async def test_proxy_forwards_run_text_generation():
    inner = FakeInner()
    events: list[dict] = []

    async def capture(ev: dict) -> None:
        events.append(ev)

    proxy = NestEventProxy(inner, capture)
    result = await proxy.run_text_generation("node-text-1")
    assert result["status"] == "completed"
    assert inner.calls == [("run_text_generation", "node-text-1")]
    assert any(ev.get("type") == "node_status" for ev in events)
    assert any(ev.get("type") == "canvas_action" for ev in events)


@pytest.mark.asyncio
async def test_proxy_run_text_generation_missing_inner_raises():
    async def noop(_ev: dict) -> None:
        return None

    proxy = NestEventProxy(object(), noop)
    with pytest.raises(RuntimeError, match="run_text_generation_not_supported"):
        await proxy.run_text_generation("node-x")
