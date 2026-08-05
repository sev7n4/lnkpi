"""Phase C: IntentParseResult schema tests."""

from __future__ import annotations

import json

from app.graph.intent_parse_schema import (
    intent_result_to_parse_outcome,
    parse_llm_json,
)


def test_parse_llm_json_valid():
    raw = json.dumps(
        {
            "action": "generate",
            "scope": "atomic",
            "route": "atomic_create",
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "title": "主图",
                    "prompt": "蓝牙耳机主图",
                    "confirm_gate": False,
                }
            ],
            "confidence": 0.92,
            "needs_clarify": False,
            "clarify_question": None,
            "reason": "明确出图",
        }
    )
    result = parse_llm_json(raw)
    assert result is not None
    assert result["action"] == "generate"
    assert result["route"] == "atomic_create"
    assert len(result["items"]) == 1
    assert result["confidence"] == 0.92


def test_parse_llm_json_missing_fields_defaults():
    raw = json.dumps({"items": []})
    result = parse_llm_json(raw)
    assert result is not None
    assert result["action"] == "unknown"
    assert result["route"] == "chat"
    assert result["confidence"] == 0.0


def test_parse_llm_json_invalid_target_type_skipped():
    raw = json.dumps(
        {
            "route": "atomic_create",
            "items": [
                {"target_type": "pdf", "prompt": "x", "title": "x"},
                {"target_type": "text", "prompt": "文案", "title": "文案"},
            ],
            "confidence": 0.9,
        }
    )
    result = parse_llm_json(raw)
    assert result is not None
    assert len(result["items"]) == 1
    assert result["items"][0]["target_type"] == "text"


def test_parse_llm_json_confidence_clamped():
    raw = json.dumps({"confidence": 1.5, "items": []})
    result = parse_llm_json(raw)
    assert result is not None
    assert result["confidence"] == 1.0


def test_intent_result_campaign_route_clarify():
    result = parse_llm_json(
        json.dumps(
            {
                "action": "plan",
                "scope": "campaign",
                "route": "campaign",
                "items": [],
                "confidence": 0.88,
                "reason": "详情页方案",
            }
        )
    )
    assert result is not None
    outcome = intent_result_to_parse_outcome(result, "设计蓝牙耳机详情页方案")
    assert outcome["kind"] == "clarify"
    assert outcome["reason"] == "llm_route_campaign"


def test_intent_result_atomic_create_success():
    result = parse_llm_json(
        json.dumps(
            {
                "action": "generate",
                "scope": "atomic",
                "route": "atomic_create",
                "structure": "single",
                "items": [
                    {
                        "target_type": "image",
                        "title": "主图",
                        "prompt": "蓝牙耳机主图",
                    }
                ],
                "confidence": 0.93,
                "reason": "明确 generate",
            }
        )
    )
    assert result is not None
    outcome = intent_result_to_parse_outcome(result, "生成一张蓝牙耳机主图")
    assert outcome["kind"] == "success"
    assert outcome["items"][0]["target_type"] == "image"


def test_intent_result_planning_conflict_clarify():
    result = parse_llm_json(
        json.dumps(
            {
                "action": "generate",
                "scope": "atomic",
                "route": "atomic_create",
                "structure": "single",
                "items": [
                    {
                        "target_type": "image",
                        "title": "主图",
                        "prompt": "蓝牙耳机主图",
                    }
                ],
                "confidence": 0.95,
                "reason": "wrong image direct",
            }
        )
    )
    assert result is not None
    utterance = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    outcome = intent_result_to_parse_outcome(result, utterance)
    assert outcome["kind"] == "clarify"
    assert outcome["reason"] == "planning_image_conflict"
