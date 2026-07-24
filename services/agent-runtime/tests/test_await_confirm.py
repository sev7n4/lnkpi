"""Unit tests for await_confirm decision tips."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.await_confirm import (
    _NONE_DECISION_TIP,
    classify_user_decision,
    make_await_confirm_node,
)


class _FakeLLM:
    async def ainvoke(self, messages, **kwargs):
        return AIMessage(content="none")


@pytest.mark.asyncio
async def test_none_decision_adds_tip_message():
    node = make_await_confirm_node(llm=_FakeLLM())
    out = await node(
        {
            "messages": [HumanMessage(content="你是谁？")],
            "awaiting_user": True,
            "phase": "await_confirm",
        }
    )
    assert out["user_decision"] == "none"
    assert out["awaiting_user"] is True
    assert out["messages"][0].content == _NONE_DECISION_TIP


@pytest.mark.asyncio
async def test_confirm_decision_adds_progress_tip():
    node = make_await_confirm_node(llm=_FakeLLM())
    out = await node(
        {
            "messages": [HumanMessage(content="确认")],
            "awaiting_user": True,
            "phase": "await_confirm",
        }
    )
    assert out["user_decision"] == "confirm"
    assert out["awaiting_user"] is False
    assert "拆解" in out["messages"][0].content
    """Same-turn plan → await_confirm must not re-prompt before user replies."""
    node = make_await_confirm_node(llm=_FakeLLM())
    out = await node(
        {
            "messages": [AIMessage(content="已生成方案摘要：…请确认…")],
            "awaiting_user": True,
            "phase": "await_confirm",
        }
    )
    assert out["user_decision"] == "none"
    assert "messages" not in out


def test_classify_confirm_and_revise():
    assert classify_user_decision("确认，按这个拆") == "confirm"
    assert classify_user_decision("改成天猫详情页") == "revise"
    assert classify_user_decision("你是谁") is None


def test_classify_wu_xiugai_is_confirm_not_revise():
    """「无修改 / 不修改」是确认语义，不能因子串「修改」误判为 revise。"""
    assert classify_user_decision("可以，无修改") == "confirm"
    assert classify_user_decision("可以，无修改。请按上一份方案拆解画布并自动出图。") == "confirm"
    assert classify_user_decision("不修改，确认拆图") == "confirm"
    assert classify_user_decision("请修改卖点文案") == "revise"


def test_classify_brief_mentioning_confirm_is_not_confirm():
    """长需求里「等我确认」是未来动作，不能直接当成对本轮方案的确认。"""
    brief = (
        "请为便携咖啡机写一份极简天猫详情页方案："
        "只需定位一句话 + 两个画面。方案写完后先等我确认再拆画布出图。"
    )
    assert classify_user_decision(brief) != "confirm"


def test_classify_pianhao_is_not_revise():
    """「偏好」不能因子串「偏」误判为 revise。"""
    assert classify_user_decision("按我的偏好出图，确认") == "confirm"
    assert classify_user_decision("改成更偏天猫详情页") == "revise"
