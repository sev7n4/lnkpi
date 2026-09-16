from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.graph.nodes.explore import make_explore_node
from app.graph.planner_copy import (
    COMPOSITION_NO_PREVIEW_REPLY,
    format_planner_preview_hitl,
    is_machine_payload_reply,
    is_planner_cancel_chip,
    is_planner_confirm_chip,
    last_successful_preview_args,
    pick_planner_slot_utterance,
    sanitize_planner_reply,
)


PROD_CONFIRM = """已落到画布，两个核心步骤：

- **模特定妆**（种子／出图方式 t2i）：半身或全身肖像，清晰五官、发型、服装
- **模特四视图**（i2i，接上一步）：一张横排四格拼图
"""


def test_sanitize_strips_prod_seed_and_gen_mode_jargon():
    out = sanitize_planner_reply(PROD_CONFIRM)
    assert "种子" not in out
    assert "t2i" not in out.lower()
    assert "i2i" not in out.lower()
    assert "模特定妆" in out
    assert "模特四视图" in out
    assert "核心步骤" in out


def test_sanitize_strips_internal_ids_and_keeps_titles():
    raw = "已接到角色三视图（内部 graft model-turnaround 1.0.0，parentId=ecommerce-product-visual）。"
    out = sanitize_planner_reply(raw)
    assert "graft" not in out.lower()
    assert "parentId" not in out
    assert "model-turnaround" not in out
    assert "ecommerce-product-visual" not in out
    assert "角色三视图" in out


def test_sanitize_empty_passthrough():
    assert sanitize_planner_reply("") == ""
    assert sanitize_planner_reply(None) == ""


def test_pick_slot_utterance_skips_confirm_chip():
    assert pick_planner_slot_utterance([
        "规划一个电商套图工作流，白色陶瓷杯放在木桌上",
        "确认落到画布",
    ]) == "规划一个电商套图工作流，白色陶瓷杯放在木桌上"


def test_pick_slot_utterance_falls_back_to_latest():
    assert pick_planner_slot_utterance(["确认落到画布"]) == "确认落到画布"
    assert pick_planner_slot_utterance([]) == ""


def test_sanitize_keeps_confirm_line():
    line = "请确认是否把改动落到画布"
    assert line in sanitize_planner_reply(f"已接到角色三视图。\n{line}")


def test_preview_hitl_uses_diff_lines_not_walkthrough():
    out = format_planner_preview_hitl({
        "parentTitle": "电商套图",
        "title": "电商套图",
        "diffLines": ["接上「角色三视图」的核心步骤", "去掉 Banner"],
        "userMessages": ["主图仍需跟着四视图，那一步没改。"],
    })
    assert "相对「电商套图」" in out
    assert "接上「角色三视图」的核心步骤" in out
    assert "去掉 Banner" in out
    assert "主图仍需跟着四视图" in out
    assert "请确认是否把改动落到画布" in out
    assert "parentId" not in out
    assert "正面视图" not in out


def test_preview_hitl_empty_delta_keeps_original_template():
    out = format_planner_preview_hitl({
        "parentTitle": "角色三视图",
        "diffLines": [],
        "userMessages": [],
    })
    assert "角色三视图" in out
    assert "原模板" in out
    assert "请确认是否把改动落到画布" in out
    assert "侧面视图" not in out


def test_machine_payload_reply_detects_tool_search_json():
    raw = (
        '{"loaded": ["get_image_edit_capabilities"], "candidates": '
        '[{"name": "get_image_edit_capabilities", "score": 1.0}], "hint": null}'
    )
    assert is_machine_payload_reply(raw) is True
    assert is_machine_payload_reply("已按「角色三视图」模板落到画布。") is False


class _Nest:
    def __init__(self) -> None:
        self.last_user_utterance = None
        self.sidebar_attachments = []
        self.get_canvas_summary = AsyncMock(return_value={"nodes": []})
        self.preview_composition = AsyncMock(
            return_value={
                "userMessage": "相对构图预览。请确认是否把构图落到画布",
                "dumpHash": "ab" * 32,
                "nodeTitles": ["定妆"],
            }
        )
        self.confirm_composition = AsyncMock(
            return_value={
                "addedNodeIds": ["image-1"],
                "canvasCommands": [{"type": "focus_nodes", "nodeIds": ["image-1"]}],
                "dumpHash": "ab" * 32,
            }
        )
        self.instantiate_recipe = AsyncMock(return_value={"addedNodeIds": ["image-1"]})


@pytest.mark.asyncio
async def test_explore_sanitizes_planner_jargon_reply():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content=PROD_CONFIRM))
    nest = _Nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="帮我规划一个角色三视图工作流")],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    nest.preview_composition.assert_awaited()
    text = result["messages"][0].content
    assert "请确认是否把构图落到画布" in text
    assert "种子" not in text
    assert nest.last_user_utterance == "帮我规划一个角色三视图工作流"


@pytest.mark.asyncio
async def test_explore_injects_prior_planning_utterance_on_confirm():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="已落到画布。"))
    nest = _Nest()
    explore = make_explore_node(llm=llm, nest=nest)
    with patch("app.graph.nodes.explore.classify_explore_intent", return_value="open_query"):
        await explore({
            "messages": [
                HumanMessage(content="规划一个电商套图工作流，白色陶瓷杯放在木桌上"),
                AIMessage(content="请确认是否把改动落到画布"),
                HumanMessage(content="确认落到画布"),
            ],
        })
    assert nest.last_user_utterance == "规划一个电商套图工作流，白色陶瓷杯放在木桌上"


@pytest.mark.asyncio
async def test_explore_preview_reply_uses_diff_ssot_not_llm_walkthrough():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(
        side_effect=[
            AIMessage(
                content="",
                tool_calls=[{
                    "name": "preview_workflow_template",
                    "args": {"parent_id": "model-turnaround", "parent_version": "1.0.0", "delta": {}},
                    "id": "p1",
                }],
            ),
            AIMessage(content="1. 正面视图\n2. 侧面视图\n3. 背面视图\n请确认是否把改动落到画布"),
        ]
    )
    nest = _Nest()
    nest.preview_composition = AsyncMock(
        return_value={
            "userMessage": "相对构图，按步骤落到画布。\n请确认是否把构图落到画布",
            "dumpHash": "cd" * 32,
            "nodeTitles": ["角色三视图"],
        }
    )
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [HumanMessage(content="帮我规划一个角色三视图工作流")],
    })
    llm.ainvoke.assert_not_called()
    text = result["messages"][0].content
    assert "请确认是否把构图落到画布" in text
    assert "侧面视图" not in text
    assert result["messages"][0].additional_kwargs.get("composition_dump_hash") == "cd" * 32


@pytest.mark.asyncio
async def test_explore_drops_tool_search_json_after_instantiate():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock()
    nest = _Nest()
    explore = make_explore_node(llm=llm, nest=nest)
    result = await explore({
        "messages": [
            HumanMessage(content="帮我规划一个角色三视图工作流"),
            AIMessage(
                content="",
                tool_calls=[{
                    "name": "preview_workflow_template",
                    "args": {"parent_id": "model-turnaround", "parent_version": "1.0.0", "delta": {}},
                    "id": "p1",
                }],
            ),
            ToolMessage(content='{"parentTitle":"角色三视图","diffLines":[]}', tool_call_id="p1"),
            HumanMessage(content="确认落到画布"),
        ],
    })
    llm.ainvoke.assert_not_called()
    nest.instantiate_recipe.assert_not_called()
    nest.confirm_composition.assert_not_called()
    text = result["messages"][0].content
    assert text == COMPOSITION_NO_PREVIEW_REPLY
    assert "loaded" not in text
    assert "get_image_edit_capabilities" not in text
    assert "未能更新节点" not in text


def test_confirm_chip_trim_exact_only():
    assert is_planner_confirm_chip("确认落到画布") is True
    assert is_planner_confirm_chip("  确认落到画布\n") is True
    assert is_planner_confirm_chip("确认落到画布吧") is False
    assert is_planner_cancel_chip("先不改") is True
    assert is_planner_cancel_chip("先不改了") is False


def _preview_turn(call_id: str, args: dict, result: dict) -> list:
    return [
        AIMessage(
            content="",
            tool_calls=[{
                "name": "preview_workflow_template",
                "args": args,
                "id": call_id,
            }],
        ),
        ToolMessage(content=json.dumps(result, ensure_ascii=False), tool_call_id=call_id),
    ]


def test_last_successful_preview_skips_failed_and_keeps_earlier():
    ok = {"parent_id": "model-turnaround", "parent_version": "1.0.0", "delta": {}}
    msgs = [
        HumanMessage(content="规划一个角色三视图工作流"),
        *_preview_turn("p1", ok, {"parentTitle": "角色三视图", "diffLines": []}),
        *_preview_turn(
            "p2",
            {"parent_id": "ecommerce-product-visual", "parent_version": "1.0.0", "delta": {"remove": ["banner"]}},
            {"error": "lint failed"},
        ),
        HumanMessage(content="确认落到画布"),
    ]
    assert last_successful_preview_args(msgs) == {
        "parent_id": "model-turnaround",
        "parent_version": "1.0.0",
        "delta": {},
    }


def test_last_successful_preview_none_when_all_fail():
    msgs = _preview_turn("p1", {"parent_id": "x", "parent_version": "1.0.0"}, {"error": "nope"})
    assert last_successful_preview_args(msgs) is None


def test_last_successful_preview_normalizes_parentId_and_missing_delta():
    msgs = _preview_turn(
        "p1",
        {"parentId": "model-turnaround", "parentVersion": "1.0.0"},
        {"ok": True},
    )
    assert last_successful_preview_args(msgs) == {
        "parent_id": "model-turnaround",
        "parent_version": "1.0.0",
        "delta": {},
    }


def test_last_successful_preview_reads_stamped_kwargs_on_hitl_reply():
    msgs = [
        HumanMessage(content="帮我规划一个角色三视图工作流"),
        AIMessage(
            content="相对「角色三视图」，按原模板落到画布。\n请确认是否把改动落到画布",
            additional_kwargs={
                "planner_preview_args": {
                    "parent_id": "model-turnaround",
                    "parent_version": "1.0.0",
                    "delta": {},
                }
            },
        ),
        HumanMessage(content="确认落到画布"),
    ]
    assert last_successful_preview_args(msgs) == {
        "parent_id": "model-turnaround",
        "parent_version": "1.0.0",
        "delta": {},
    }

