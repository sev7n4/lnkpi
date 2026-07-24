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
async def test_post_plan_ai_turn_skips_tip():
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
