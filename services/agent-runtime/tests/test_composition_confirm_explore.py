"""Explore composition preview + confirm short-circuit (no LLM, no instantiate)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.composition_route import GOLD_COMPOSE_1
from app.graph.explore_dispatch import select_narrow_write_tools
from app.graph.nodes.explore import make_explore_node


HITL_CONFIRM = "请确认是否把构图落到画布"
DUMP_HASH = "ab" * 32
_PLANNER_TOOLS = frozenset({
    "preview_workflow_template",
    "match_workflow_templates",
    "promote_workflow_template",
})


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
            "userMessage": f"已预览构图。{HITL_CONFIRM}",
            "dumpHash": DUMP_HASH,
            "nodeTitles": ["定妆", "换装"],
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


@pytest.mark.asyncio
async def test_gold_preview_does_not_call_llm():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
    })
    nest.preview_composition.assert_awaited_once_with(GOLD_COMPOSE_1)
    nest.instantiate_recipe.assert_not_called()
    llm.ainvoke.assert_not_called()
    assert HITL_CONFIRM in result["messages"][0].content
    assert result["messages"][0].additional_kwargs.get("composition_dump_hash") == DUMP_HASH
    assert result["messages"][0].additional_kwargs.get("kind") == "composition"
    assert result.get("composition_dump_hash") == DUMP_HASH
    assert result.get("composition_pending") is None


@pytest.mark.asyncio
async def test_preview_copies_sidebar_attachments_onto_nest():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    attachments = [
        {
            "id": "att-i1",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "I1",
            "url": "https://cdn.example/i1.png",
        }
    ]
    await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
        "sidebar_attachments": attachments,
    })
    nest.preview_composition.assert_awaited_once_with(GOLD_COMPOSE_1)
    assert nest.sidebar_attachments == attachments


@pytest.mark.asyncio
async def test_confirm_chip_imports_composition_not_instantiate():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    cmds = [{"type": "focus_nodes", "nodeIds": ["image-1"]}]
    result = await explore({
        "messages": [
            HumanMessage(content=GOLD_COMPOSE_1),
            AIMessage(
                content=f"已预览构图。{HITL_CONFIRM}",
                additional_kwargs={
                    "kind": "composition",
                    "composition_dump_hash": DUMP_HASH,
                },
            ),
            HumanMessage(content="确认落到画布"),
        ],
    })
    nest.confirm_composition.assert_awaited_once_with(DUMP_HASH)
    nest.instantiate_recipe.assert_not_called()
    nest.preview_composition.assert_not_called()
    llm.ainvoke.assert_not_called()
    assert result["messages"][0].content == "已按构图落到画布。"
    assert result["canvas_commands"] == cmds


@pytest.mark.asyncio
async def test_confirm_without_preview_uses_composition_copy():
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
    assert text == "请先确认构图，再落到画布。"
    assert "未能更新节点" not in text
    assert "canvas_commands" not in result


@pytest.mark.asyncio
async def test_extract_incomplete_sets_pending_no_instantiate():
    from app.errors import AgentToolError

    llm = _llm()
    nest = _nest()
    nest.preview_composition = AsyncMock(
        side_effect=AgentToolError({
            "error_type": "param_error",
            "tool_name": "previewComposition",
            "message": "请指明哪张是模特、哪张是服装。",
            "retry_hint": "请检查参数后重试",
        })
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    assert result["messages"][0].content == "请指明哪张是模特、哪张是服装。"
    pending = result.get("composition_pending")
    assert pending
    parsed = json.loads(pending) if isinstance(pending, str) else pending
    assert parsed.get("utterance")
    assert parsed.get("ts")


@pytest.mark.asyncio
async def test_lint_fail_returns_user_message_no_ainvoke():
    from app.errors import AgentToolError

    llm = _llm()
    nest = _nest()
    nest.preview_composition = AsyncMock(
        side_effect=AgentToolError({
            "error_type": "param_error",
            "tool_name": "previewComposition",
            "message": "这版构图还不能放到画布，请稍后再试或简化步骤。",
            "retry_hint": "请检查参数后重试",
        })
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content=GOLD_COMPOSE_1)],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    assert result["messages"][0].content == "这版构图还不能放到画布，请稍后再试或简化步骤。"
    assert not result.get("composition_pending")


@pytest.mark.asyncio
async def test_pending_state_previews_without_structure_keywords():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="@I1 是模特")],
        "composition_pending": '{"identityRef":"I1"}',
    })
    nest.preview_composition.assert_awaited_once_with("@I1 是模特")
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    assert HITL_CONFIRM in result["messages"][0].content
    assert result.get("composition_pending") is None


@pytest.mark.asyncio
async def test_confirm_uses_state_dump_hash():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="确认落到画布")],
        "composition_dump_hash": DUMP_HASH,
    })
    nest.confirm_composition.assert_awaited_once_with(DUMP_HASH)
    nest.instantiate_recipe.assert_not_called()
    llm.ainvoke.assert_not_called()
    assert result["messages"][0].content == "已按构图落到画布。"


def test_gold_structure_binds_no_planner_writes():
    tools = select_narrow_write_tools(GOLD_COMPOSE_1)
    assert tools == frozenset()
    assert tools != _PLANNER_TOOLS
    assert "instantiate_workflow_template" not in tools
    assert "match_workflow_templates" not in tools


def test_confirm_chip_does_not_bind_instantiate():
    tools = select_narrow_write_tools("确认落到画布")
    assert "instantiate_workflow_template" not in tools
    assert "preview_workflow_template" not in tools
    assert tools != _PLANNER_TOOLS


def test_runtime_state_keeps_composition_checkpoint_keys():
    from app.graph.state import AgentRuntimeState

    hints = AgentRuntimeState.__annotations__
    assert "composition_pending" in hints
    assert "composition_dump_hash" in hints


def _stale_pending() -> str:
    return json.dumps(
        {
            "utterance": "作为模特换装，服装图",
            "ts": (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat(),
        }
    )


@pytest.mark.asyncio
async def test_stale_pending_skips_preview_and_clears():
    llm = _llm()
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="好的"))
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="继续刚才那个")],
        "composition_pending": _stale_pending(),
    })
    nest.preview_composition.assert_not_called()
    assert result.get("composition_pending") is None


@pytest.mark.asyncio
async def test_pending_qing_tryon_skips_preview_and_clears():
    llm = _llm()
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="好的"))
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="@I1 模特 @I2 @I3 产品，请让模特穿上，保持构图不变")],
        "composition_pending": '{"utterance":"作为模特换装，服装图"}',
    })
    nest.preview_composition.assert_not_called()
    assert result.get("composition_pending") is None


@pytest.mark.asyncio
async def test_pending_chat_skips_preview_and_clears():
    llm = _llm()
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="你好"))
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="你好")],
        "composition_pending": '{"identityRef":"I1"}',
    })
    nest.preview_composition.assert_not_called()
    assert result.get("composition_pending") is None


@pytest.mark.asyncio
async def test_pending_bare_i_assignment_previews():
    llm = _llm()
    nest = _nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="I1 模特 I2 I3 服装")],
        "composition_pending": '{"utterance":"作为模特换装，服装图"}',
    })
    nest.preview_composition.assert_awaited_once_with("I1 模特 I2 I3 服装")
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    assert HITL_CONFIRM in result["messages"][0].content
    assert result.get("composition_pending") is None
