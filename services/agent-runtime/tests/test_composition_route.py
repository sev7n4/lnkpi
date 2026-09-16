"""Composition structure / confirm detectors (Task 7)."""

from __future__ import annotations

from app.graph.composition_route import (
    GOLD_COMPOSE_1,
    GOLD_COMPOSE_2,
    is_composition_confirm_chip,
    is_composition_structure_utterance,
    is_fresh_composition_pending,
    is_live_composition_pending,
    leaves_composition_pending,
)

GOLD = (
    "@I1 作为模特，@I2 @I3 这两个是服装图，设计一段模特换装的工作流并做好连线，"
    "写入画布，待我确认后再做生图生视频"
)


def test_gold_compose_constants_match_ts():
    assert GOLD_COMPOSE_1 == GOLD
    assert GOLD_COMPOSE_2 == (
        "@I1 是产品，@I2 是使用场景，先出一张白底再出一张场景图，连好线写到画布，先不要生成"
    )


def test_gold_structure_detector():
    assert is_composition_structure_utterance(GOLD) is True
    assert is_composition_structure_utterance("换装") is False
    assert is_composition_structure_utterance("生图生视频") is False


def test_gold2_structure_detector():
    assert is_composition_structure_utterance(GOLD_COMPOSE_2) is True


def test_structure_keyword_pairs():
    assert is_composition_structure_utterance("做一个图生视频工作流") is True
    assert is_composition_structure_utterance("规划一套流水线") is True
    assert is_composition_structure_utterance("连线写入画布") is True
    assert is_composition_structure_utterance("连好线写到画布") is True
    assert is_composition_structure_utterance("改画布上那个节点的提示词") is False


def test_confirm_chip_exact_trim():
    assert is_composition_confirm_chip("确认落到画布") is True
    assert is_composition_confirm_chip("  确认落到画布\n") is True
    assert is_composition_confirm_chip("确认落到画布吧") is False
    assert is_composition_confirm_chip("先不改") is True
    assert is_composition_confirm_chip("先不改了") is False
    assert is_composition_confirm_chip("") is False
    assert is_composition_confirm_chip(None) is False


def test_pending_ttl_and_leave_helpers():
    import json
    from datetime import datetime, timedelta, timezone

    fresh = json.dumps({"utterance": "x", "ts": datetime.now(timezone.utc).isoformat()})
    stale = json.dumps(
        {
            "utterance": "x",
            "ts": (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat(),
        }
    )
    assert is_fresh_composition_pending(fresh) is True
    assert is_fresh_composition_pending(stale) is False
    assert is_fresh_composition_pending('{"identityRef":"I1"}') is True
    assert leaves_composition_pending("I1 模特 I2 I3 服装") is False
    assert leaves_composition_pending("继续刚才那个") is False
    assert leaves_composition_pending("你好") is True
    assert leaves_composition_pending("生成一张猫") is True
    assert leaves_composition_pending("@I1 模特 @I2 产品，让模特穿上，保持构图不变") is True
    assert is_live_composition_pending(fresh, "I1 模特 I2 I3 服装") is True
    assert is_live_composition_pending(stale, "继续刚才那个") is False
    assert is_live_composition_pending(fresh, "你好") is False
