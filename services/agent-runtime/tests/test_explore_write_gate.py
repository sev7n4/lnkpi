"""Tests for node_write loop gate (Phase 2b)."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node


@pytest.mark.asyncio
async def test_node_write_loop_gate_clarifies_after_empty_tool_calls():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(
        side_effect=[
            AIMessage(content="好的，已更新。"),
            AIMessage(content="仍然无法调用。"),
        ]
    )

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})

    fake_tool = MagicMock()
    fake_tool.name = "set_node_prompt"
    fake_tool.ainvoke = AsyncMock(return_value={"ok": True})

    import app.graph.nodes.explore as explore_mod

    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [fake_tool]
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore(
            {
                "messages": [
                    HumanMessage(
                        content="查询 prompt-1 节点，把 prompt 更新为 explore-set-prompt-测试"
                    )
                ],
            }
        )
    finally:
        explore_mod.build_explore_tools = original

    assert llm.bind_tools.call_count >= 2
    assert "未能更新节点" in result["messages"][0].content
