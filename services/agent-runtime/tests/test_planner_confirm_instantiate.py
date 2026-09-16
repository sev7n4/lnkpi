"""Confirm chip lands composition dump, never instantiates planner recipes."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.errors import AgentToolError
from app.graph.composition_route import GOLD_COMPOSE_1
from app.graph.nodes.explore import make_explore_node
from app.graph.planner_copy import (
    COMPOSITION_CANCEL_REPLY,
    COMPOSITION_LANDED_REPLY,
    COMPOSITION_NO_PREVIEW_REPLY,
    PLANNER_CANCEL_REPLY,
)

DUMP_HASH = "ab" * 32
HITL = "请确认是否把构图落到画布"


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
    nest.preview_composition = AsyncMock(
        return_value={
            "userMessage": f"已预览构图。{HITL}",
            "dumpHash": DUMP_HASH,
            "nodeTitles": ["定妆"],
        }
    )
    nest.confirm_composition = AsyncMock(
        return_value={
            "addedNodeIds": ["image-1"],
            "canvasCommands": [{"type": "focus_nodes", "nodeIds": ["image-1"]}],
            "dumpHash": DUMP_HASH,
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
    """Planner preview_args without composition hash never instantiate."""
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [*_preview_messages(), HumanMessage(content="确认落到画布")],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    nest.confirm_composition.assert_not_called()
    assert result["messages"][0].content == COMPOSITION_NO_PREVIEW_REPLY
    assert "canvas_commands" not in result


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
    nest.confirm_composition.assert_not_called()
    text = result["messages"][0].content
    assert text == COMPOSITION_NO_PREVIEW_REPLY
    assert "未能更新节点" not in text
    assert "请先规划并确认模板改动" not in text
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
    nest.confirm_composition.assert_not_called()
    nest.preview_composition.assert_not_called()
    assert result["messages"][0].content == COMPOSITION_CANCEL_REPLY
    assert result["messages"][0].content == PLANNER_CANCEL_REPLY


@pytest.mark.asyncio
async def test_instantiate_error_shows_nest_user_message():
    llm = _llm()
    nest = _nest()
    nest.confirm_composition = AsyncMock(
        side_effect=AgentToolError({
            "error_type": "param_error",
            "tool_name": "confirmComposition",
            "message": "请先确认构图，再落到画布。",
            "retry_hint": "请检查参数后重试",
        })
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [
            HumanMessage(content=GOLD_COMPOSE_1),
            AIMessage(
                content=HITL,
                additional_kwargs={
                    "kind": "composition",
                    "composition_dump_hash": DUMP_HASH,
                },
            ),
            HumanMessage(content="确认落到画布"),
        ],
    })
    text = result["messages"][0].content
    assert text == COMPOSITION_NO_PREVIEW_REPLY
    assert "未能更新节点" not in text
    nest.instantiate_recipe.assert_not_called()
    llm.ainvoke.assert_not_called()


@pytest.mark.asyncio
async def test_confirm_uses_stamped_preview_args_from_explore_hitl_reply():
    """Prod shape: checkpoint keeps HITL AIMessage with composition dump hash."""
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    planned = await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
    })
    hitl = planned["messages"][0]
    assert hitl.additional_kwargs.get("composition_dump_hash") == DUMP_HASH
    assert hitl.additional_kwargs.get("kind") == "composition"
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    llm.ainvoke.reset_mock()
    nest.instantiate_recipe.reset_mock()
    nest.preview_composition.reset_mock()
    confirmed = await explore({
        "messages": [
            HumanMessage(content=GOLD_COMPOSE_1),
            hitl,
            HumanMessage(content="确认落到画布"),
        ],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    nest.confirm_composition.assert_awaited_once_with(DUMP_HASH)
    assert confirmed["messages"][0].content == COMPOSITION_LANDED_REPLY
    assert confirmed["canvas_commands"] == [{"type": "focus_nodes", "nodeIds": ["image-1"]}]
    assert "未能更新节点" not in confirmed["messages"][0].content
