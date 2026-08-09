"""Tests for explore node mandatory dispatch wiring."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node


@pytest.mark.asyncio
async def test_explore_mandatory_skips_llm():
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock()

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(
        return_value={
            "nodes": [{"id": "image-1786157513657-20", "title": "换logo李宁"}],
        }
    )

    undo_tool = MagicMock()
    undo_tool.ainvoke = AsyncMock(
        return_value={"ok": True, "canvasCommands": [{"type": "undo"}]}
    )

    explore = make_explore_node(llm=llm, nest=nest)

    # Patch build_explore_tools via explore module import path
    import app.graph.nodes.explore as explore_mod

    original_build = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [  # type: ignore[assignment]
        MagicMock(name="undo", ainvoke=undo_tool.ainvoke),
    ]
    # StructuredTool needs .name
    fake_undo = MagicMock()
    fake_undo.name = "undo"
    fake_undo.ainvoke = undo_tool.ainvoke
    explore_mod.build_explore_tools = lambda _nest: [fake_undo]  # type: ignore[assignment]

    try:
        state = {
            "messages": [HumanMessage(content="查询画布，撤销上一步画布编辑操作")],
        }
        result = await explore(state)
    finally:
        explore_mod.build_explore_tools = original_build

    assert llm.ainvoke.await_count == 0
    assert result.get("canvas_commands") == [{"type": "undo"}]
    assert isinstance(result["messages"][0], AIMessage)
    assert "撤销" in result["messages"][0].content
