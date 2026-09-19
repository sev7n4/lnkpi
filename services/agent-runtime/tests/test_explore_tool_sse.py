"""Explore LLM loop emits tool_call/tool_result; canvas summary does not."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node

GOLD = "帮我生成一张蓝色天空产品主图"


@pytest.mark.asyncio
async def test_t1_t2_gold_emits_upsert_then_propose_not_summary():
    events: list[dict] = []

    async def capture(event: dict) -> None:
        events.append(event)

    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(
        side_effect=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "upsert_media_node",
                        "args": {"target_type": "image", "prompt": "蓝色天空产品主图"},
                        "id": "1",
                    },
                    {
                        "name": "propose_generation",
                        "args": {"node_id": "image-1"},
                        "id": "2",
                    },
                ],
            ),
            AIMessage(content="已提交待确认。"),
        ]
    )

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})
    nest._emit = capture

    upsert = MagicMock()
    upsert.name = "upsert_media_node"
    upsert.ainvoke = AsyncMock(return_value={"ok": True, "nodeId": "image-1"})
    propose = MagicMock()
    propose.name = "propose_generation"
    propose.ainvoke = AsyncMock(return_value={"ok": True, "status": "pending_confirm"})

    import app.graph.nodes.explore as explore_mod

    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [upsert, propose]
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore({"messages": [HumanMessage(content=GOLD)]})
    finally:
        explore_mod.build_explore_tools = original

    assert "已提交待确认" in result["messages"][0].content
    names = [
        str((e.get("data") or {}).get("name") or "")
        for e in events
        if e.get("type") == "tool_call"
    ]
    assert names == ["upsert_media_node", "propose_generation"]
    results = [
        str((e.get("data") or {}).get("name") or "")
        for e in events
        if e.get("type") == "tool_result"
    ]
    assert results == ["upsert_media_node", "propose_generation"]
    assert "get_canvas_summary" not in names
    nest.get_canvas_summary.assert_awaited()
