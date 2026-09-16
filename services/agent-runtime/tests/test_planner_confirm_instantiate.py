"""Spec §5: confirm chip instantiates without LLM."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.errors import AgentToolError
from app.graph.nodes.explore import make_explore_node
from app.graph.planner_copy import (
    PLANNER_CANCEL_REPLY,
    PLANNER_INSTANTIATED_REPLY,
    PLANNER_NO_PREVIEW_REPLY,
)


def _llm() -> MagicMock:
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock()
    return llm


def _nest() -> MagicMock:
    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})
    nest.last_user_utterance = None
    nest.sidebar_attachments = []
    nest.instantiate_recipe = AsyncMock(
        return_value={
            "addedNodeIds": ["image-1"],
            "canvasCommands": [{"type": "focus_node", "nodeId": "image-1"}],
        }
    )
    return nest


def _preview_messages() -> list:
    return [
        HumanMessage(content="帮我规划一个角色三视图工作流"),
        AIMessage(
            content="",
            tool_calls=[{
                "name": "preview_workflow_template",
                "args": {
                    "parent_id": "model-turnaround",
                    "parent_version": "1.0.0",
                    "delta": {"remove": []},
                },
                "id": "p1",
            }],
        ),
        ToolMessage(
            content='{"parentTitle":"角色三视图","diffLines":[]}',
            tool_call_id="p1",
        ),
    ]


@pytest.mark.asyncio
async def test_confirm_chip_instantiates_preview_args_without_llm():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [*_preview_messages(), HumanMessage(content="确认落到画布")],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_awaited_once_with(
        parent_id="model-turnaround",
        parent_version="1.0.0",
        delta={"remove": []},
    )
    assert result["messages"][0].content == PLANNER_INSTANTIATED_REPLY
    assert result["canvas_commands"] == [{"type": "focus_node", "nodeId": "image-1"}]


@pytest.mark.asyncio
async def test_confirm_without_preview_does_not_write_or_ask_node_id():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="确认落到画布")],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    text = result["messages"][0].content
    assert text == PLANNER_NO_PREVIEW_REPLY
    assert "未能更新节点" not in text
    assert "canvas_commands" not in result


@pytest.mark.asyncio
async def test_cancel_chip_does_not_instantiate():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [*_preview_messages(), HumanMessage(content="先不改")],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    assert result["messages"][0].content == PLANNER_CANCEL_REPLY


@pytest.mark.asyncio
async def test_instantiate_error_shows_nest_user_message():
    llm = _llm()
    nest = _nest()
    nest.instantiate_recipe = AsyncMock(
        side_effect=AgentToolError({
            "error_type": "param_error",
            "tool_name": "instantiateRecipe",
            "message": "还有步骤没写提示词，先补上再放到画布。",
            "retry_hint": "请检查参数后重试",
        })
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [*_preview_messages(), HumanMessage(content="确认落到画布")],
    })
    text = result["messages"][0].content
    assert text == "还有步骤没写提示词，先补上再放到画布。"
    assert "未能更新节点" not in text
    llm.ainvoke.assert_not_called()
