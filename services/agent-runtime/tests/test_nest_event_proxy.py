"""NestEventProxy forwards P4 Harness modalities to inner client."""

from __future__ import annotations

import pytest

from app.runs import NestEventProxy


class FakeInner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.apply_calls: list[dict] = []

    async def run_text_generation(self, node_id: str) -> dict:
        self.calls.append(("run_text_generation", node_id))
        return {
            "status": "completed",
            "generationRecordId": "rec-text-1",
            "actions": [{"type": "update_node", "payload": {"id": node_id}}],
        }

    async def apply_sidebar_attachments(
        self,
        *,
        node_ids: list[str],
        attachments: list[dict],
        ref_order: list[str] | None,
        mode: str,
    ) -> dict:
        self.apply_calls.append(
            {
                "node_ids": node_ids,
                "attachments": attachments,
                "ref_order": ref_order,
                "mode": mode,
            }
        )
        return {
            "actions": [
                {
                    "type": "update_node",
                    "payload": {"id": node_ids[0], "data": {"localRefs": attachments}},
                }
            ],
            "sourceNodeIds": [],
        }


@pytest.mark.asyncio
async def test_proxy_forwards_apply_sidebar_attachments():
    inner = FakeInner()
    events: list[dict] = []

    async def capture(ev: dict) -> None:
        events.append(ev)

    proxy = NestEventProxy(inner, capture)
    attachments = [
        {
            "id": "a1",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "ref.jpg",
            "url": "https://example.com/a.jpg",
        }
    ]
    result = await proxy.apply_sidebar_attachments(
        node_ids=["node-img-1"],
        attachments=attachments,
        ref_order=["a1"],
        mode="localRefs",
    )
    assert inner.apply_calls
    assert inner.apply_calls[0]["mode"] == "localRefs"
    assert any(ev.get("type") == "canvas_action" for ev in events)
    assert result["actions"]


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
