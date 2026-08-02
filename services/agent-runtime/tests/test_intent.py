"""Unified intent module tests (W9)."""

from __future__ import annotations

from app.graph.intent import (
    classify_copy_decision,
    classify_topo_decision,
    classify_user_decision,
    modify_intent,
)


def test_modify_intent_keywords():
    assert modify_intent("改成更运动风")
    assert modify_intent("删掉 Banner")
    assert not modify_intent("确认出图")


def test_classify_copy_decision():
    assert classify_copy_decision("写入主文案") == "confirm"
    assert classify_copy_decision("改成更强调节水") == "revise"
    assert classify_copy_decision("随便看看") == "none"


def test_classify_topo_decision():
    assert classify_topo_decision("确认出图") == "confirm_gen"
    assert classify_topo_decision("删掉 Banner") == "topo_revise"
    assert classify_topo_decision("改为双人模特") == "node_revise"


def test_classify_user_decision():
    assert classify_user_decision("1") == "confirm"
    assert classify_user_decision("3") == "revise"
    assert classify_user_decision("确认方案") == "confirm"
