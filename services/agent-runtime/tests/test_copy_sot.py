"""Tests for copy SoT resolution fallbacks."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage

from app.graph.copy_sot import (
    brief_from_messages,
    plan_content_from_node,
    resolve_copy_sot,
    snapshot_copy_sot_fields,
)


def test_brief_from_messages_skips_confirm_tokens():
    msgs = [
        HumanMessage(content="请帮我做一个lnkpi蓝牙耳机营销方案"),
        HumanMessage(content="1"),
        HumanMessage(content="写入主文案"),
    ]
    assert "lnkpi" in brief_from_messages(msgs)
    assert brief_from_messages(msgs) == "请帮我做一个lnkpi蓝牙耳机营销方案"


def test_plan_content_from_node_reads_data_content():
    node = {"id": "p1", "data": {"content": "# lnkpi 蓝牙耳机方案\nTWS 真无线"}}
    text = plan_content_from_node(node)
    assert "蓝牙耳机" in text


@pytest.mark.asyncio
async def test_resolve_copy_sot_falls_back_to_plan_node():
    class FakeNest:
        async def get_node(self, node_id: str) -> dict:
            return {
                "id": node_id,
                "data": {"content": "# lnkpi 蓝牙耳机企业营销方案\n| 产品类别 | TWS 耳机 |"},
            }

        async def get_context_snapshot(self, *, thread_id: str, stage: str | None = None):
            return None

    sot = await resolve_copy_sot(
        {"plan_node_id": "plan-1", "messages": [HumanMessage(content="请帮我做lnkpi耳机方案")]},
        FakeNest(),
    )
    assert "lnkpi" in sot.user_brief.lower() or "耳机" in sot.user_brief
    assert "蓝牙耳机" in sot.plan_draft or "TWS" in sot.plan_draft


@pytest.mark.asyncio
async def test_resolve_copy_sot_falls_back_to_context_snapshot():
    class FakeNest:
        async def get_context_snapshot(self, *, thread_id: str, stage: str | None = None):
            if stage == "split":
                return {
                    "brief": "快照 brief",
                    "planSummary": "快照 plan 摘要",
                }
            return None

    sot = await resolve_copy_sot({"thread_id": "t1", "messages": []}, FakeNest())
    assert sot.user_brief == "快照 brief"
    assert sot.plan_draft == "快照 plan 摘要"


def test_snapshot_copy_sot_fields():
    snap = snapshot_copy_sot_fields(
        {
            "user_brief": "请帮我做lnkpi耳机",
            "plan_draft": "# 方案",
        }
    )
    assert snap["copy_sot_brief"] == "请帮我做lnkpi耳机"
    assert snap["copy_sot_plan"] == "# 方案"
