"""V5: same-turn tool_search load must rebind tools (bind_tools twice)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node
from app.tools.tool_plan import META_TOOL_NAME


@pytest.mark.asyncio
async def test_tool_search_same_turn_rebind_calls_bind_tools_twice():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(
        side_effect=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": META_TOOL_NAME,
                        "args": {"query": "public assets list", "limit": 5},
                        "id": "ts1",
                    }
                ],
            ),
            AIMessage(content="已加载公共素材工具。"),
        ]
    )

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})

    # Use real tool_search via explore; only stub build_explore_tools catalog.
    deferred = MagicMock()
    deferred.name = "list_public_assets"
    deferred.ainvoke = AsyncMock(return_value={"ok": True})

    import app.graph.nodes.explore as explore_mod

    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [deferred]
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore(
            {"messages": [HumanMessage(content="帮我找公共素材相关工具")]}
        )
    finally:
        explore_mod.build_explore_tools = original

    assert llm.bind_tools.call_count >= 2
    assert result["messages"][0].content
    assert "list_public_assets" in (result.get("tool_plan_loaded") or [])
