from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.explore import make_explore_node
from app.graph.planner_copy import pick_planner_slot_utterance, sanitize_planner_reply


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


class _Nest:
    def __init__(self) -> None:
        self.last_user_utterance = None
        self.sidebar_attachments = []
        self.get_canvas_summary = AsyncMock(return_value={"nodes": []})


@pytest.mark.asyncio
async def test_explore_sanitizes_planner_jargon_reply():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content=PROD_CONFIRM))
    nest = _Nest()
    explore = make_explore_node(llm=llm, nest=nest)
    with patch("app.graph.nodes.explore.classify_explore_intent", return_value="open_query"):
        result = await explore({
            "messages": [HumanMessage(content="帮我规划一个角色三视图工作流")],
        })
    text = result["messages"][0].content
    assert "种子" not in text
    assert "t2i" not in text.lower()
    assert "i2i" not in text.lower()
    assert "模特定妆" in text
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
