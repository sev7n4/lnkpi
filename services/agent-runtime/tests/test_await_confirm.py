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


@pytest.mark.asyncio
async def test_revise_decision_sets_modify_mode_when_brief_and_plan_exist():
    # 修复 P0-3 盲点：await_confirm → revise → plan 路径不经过 intake，
    # 必须在 await_confirm 节点同步设 mode=modify，否则 plan 会走 create 分支
    # 重新生成全新方案而非增量修改
    node = make_await_confirm_node(llm=_FakeLLM())
    out = await node(
        {
            "messages": [HumanMessage(content="改成双人模特")],
            "awaiting_user": True,
            "phase": "await_confirm",
            "user_brief": "帮我做一套洁具详情页营销方案",
            "plan_draft": "# 洁具详情页方案\n## 定位...",
        }
    )
    assert out["user_decision"] == "revise"
    assert out["mode"] == "modify", (
        "revise + 已有 brief/plan 时必须设 mode=modify，"
        "否则 plan 节点会走 create 分支重新生成全新方案"
    )


@pytest.mark.asyncio
async def test_revise_decision_does_not_set_mode_without_brief():
    # 边界 case：revise 但没有 brief/plan（理论上不该发生，但防御性处理）
    node = make_await_confirm_node(llm=_FakeLLM())
    out = await node(
        {
            "messages": [HumanMessage(content="改成运动鞋")],
            "awaiting_user": True,
            "phase": "await_confirm",
        }
    )
    assert out["user_decision"] == "revise"
    # 没有 brief/plan 时不设 mode（保留原 state 值，让 plan 节点用默认 create）
    assert "mode" not in out
