"""Tests for W28 single_node_gen_intent."""

from __future__ import annotations

from app.graph.intent import marketing_intent, single_node_gen_intent


def test_single_node_gen_intent_keywords():
    assert single_node_gen_intent("快速生成这张主图")
    assert single_node_gen_intent("只生成这张")
    assert single_node_gen_intent("重新生成这张")


def test_single_node_gen_intent_does_not_match_full_campaign():
    text = "帮我做一套蓝牙音箱天猫详情页营销方案并出图"
    assert marketing_intent(text)
    assert not single_node_gen_intent(text)


def test_single_node_short_commands():
    assert single_node_gen_intent("快速生成")
    assert not single_node_gen_intent("确认出图")
