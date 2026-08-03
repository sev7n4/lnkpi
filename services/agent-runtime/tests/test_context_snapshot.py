"""W18: Context snapshot storage roundtrip and LLM context resolution."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.graph.context_snapshot import (
    build_snapshot_payload,
    load_context_snapshot,
    manifest_summary_json,
    persist_snapshot_from_state,
    resolve_brief_for_llm,
    save_context_snapshot,
)


class _FakeNest:
    def __init__(self) -> None:
        self.saved: list[dict[str, Any]] = []
        self.store: dict[str, dict[str, Any]] = {}

    async def save_context_snapshot(
        self,
        *,
        thread_id: str,
        session_id: str,
        stage: str,
        brief: str | None = None,
        plan_summary: str | None = None,
        manifest_json: str | None = None,
        message_count: int | None = None,
    ) -> dict[str, str]:
        snap_id = f"snap-{len(self.saved) + 1}"
        row = {
            "id": snap_id,
            "threadId": thread_id,
            "sessionId": session_id,
            "stage": stage,
            "brief": brief,
            "planSummary": plan_summary,
            "manifestJson": manifest_json,
            "messageCount": message_count,
        }
        self.saved.append(row)
        key = f"{thread_id}:{stage}"
        self.store[key] = row
        self.store[thread_id] = row
        return {"id": snap_id}

    async def get_context_snapshot(
        self, *, thread_id: str, stage: str | None = None
    ) -> dict[str, Any] | None:
        if stage:
            return self.store.get(f"{thread_id}:{stage}")
        return self.store.get(thread_id)


def test_manifest_summary_json_compact():
    raw = manifest_summary_json(
        [
            {"key": "hero", "title": "主图", "target_type": "image", "node_id": "n1"},
            {"key": "copy_main", "title": "主文案", "target_type": "text"},
        ]
    )
    assert raw is not None
    parsed = json.loads(raw)
    assert len(parsed) == 2
    assert parsed[0]["key"] == "hero"
    assert "node_id" not in parsed[0]


def test_build_snapshot_payload_from_state():
    payload = build_snapshot_payload(
        {
            "thread_id": "t1",
            "session_id": "s1",
            "user_brief": "做耳机广告",
            "plan_summary": "降噪旗舰",
            "split_manifest": [{"key": "hero", "title": "主图", "target_type": "image"}],
            "messages": [{"role": "user", "content": "hello"}],
        },
        "split",
    )
    assert payload["threadId"] == "t1"
    assert payload["stage"] == "split"
    assert payload["brief"] == "做耳机广告"
    assert payload["planSummary"] == "降噪旗舰"
    assert payload["messageCount"] == 1
    assert json.loads(payload["manifestJson"]) == [
        {"key": "hero", "title": "主图", "target_type": "image"}
    ]


@pytest.mark.asyncio
async def test_save_and_load_roundtrip():
    nest = _FakeNest()
    payload = build_snapshot_payload(
        {
            "thread_id": "t1",
            "session_id": "s1",
            "user_brief": "brief",
            "plan_summary": "plan",
        },
        "plan",
    )
    snap_id = await save_context_snapshot(nest, payload)
    assert snap_id == "snap-1"
    loaded = await load_context_snapshot(nest, "t1", stage="plan")
    assert loaded is not None
    assert loaded["brief"] == "brief"
    assert loaded["planSummary"] == "plan"


@pytest.mark.asyncio
async def test_persist_snapshot_from_state_returns_id():
    nest = _FakeNest()
    patch = await persist_snapshot_from_state(
        nest,
        {
            "thread_id": "t1",
            "session_id": "s1",
            "user_brief": "耳机",
            "plan_draft": "# 方案",
            "plan_summary": "摘要",
        },
        "plan",
    )
    assert patch["context_snapshot_id"] == "snap-1"
    assert len(nest.saved) == 1


@pytest.mark.asyncio
async def test_resolve_brief_for_llm_prefers_snapshot_over_messages():
    nest = _FakeNest()
    await nest.save_context_snapshot(
        thread_id="t1",
        session_id="s1",
        stage="plan",
        brief="来自快照的 brief",
        plan_summary="plan",
    )
    # Many messages — snapshot should win without scanning all
    messages = [{"role": "user", "content": f"noise-{i}"} for i in range(50)]
    brief = await resolve_brief_for_llm(
        {"thread_id": "t1", "messages": messages},
        nest,
    )
    assert brief == "来自快照的 brief"
