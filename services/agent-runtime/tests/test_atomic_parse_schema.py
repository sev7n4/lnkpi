"""Phase 2: atomic parse schema validation tests."""

from __future__ import annotations

from app.graph.atomic_parse_schema import (
    CLARIFY_THRESHOLD,
    validate_parse_result,
)


def test_validate_success_single():
    out = validate_parse_result(
        {
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "prompt": "模特人物图",
                    "title": "模特人物图",
                    "confirm_gate": False,
                }
            ],
            "confidence": 0.92,
            "reason": "test",
        },
        utterance="帮我生成一个模特人物图",
    )
    assert out["kind"] == "success"
    assert len(out["items"]) == 1
    assert out["items"][0]["target_type"] == "image"


def test_validate_clarify_low_confidence():
    out = validate_parse_result(
        {"confidence": 0.4, "reason": "vague", "items": []},
        utterance="帮我生成",
    )
    assert out["kind"] == "clarify"
    assert out["confidence"] < CLARIFY_THRESHOLD
    assert out["clarify_question"]


def test_validate_rejects_invalid_target_type():
    out = validate_parse_result(
        {
            "items": [{"target_type": "unknown", "prompt": "x", "title": "x"}],
            "confidence": 0.9,
        },
        utterance="test",
    )
    assert out["kind"] == "clarify"


def test_validate_video_confirm_gate_default():
    out = validate_parse_result(
        {
            "items": [{"target_type": "video", "prompt": "15秒展示", "title": "视频"}],
            "confidence": 0.9,
        },
        utterance="做一个15秒视频",
    )
    assert out["kind"] == "success"
    assert out["items"][0]["confirm_gate"] is True


def test_validate_preserves_turnaround_pipeline_fields():
    out = validate_parse_result(
        {
            "items": [
                {
                    "target_type": "image",
                    "prompt": "山海经吞金兽的三视图，CG风格",
                    "title": "山海经吞金兽的三视图，CG风格",
                    "confirm_gate": False,
                    "pipeline": "turnaround_image",
                    "imageAspect": "2:1",
                    "resolutionBump": True,
                }
            ],
            "confidence": 0.96,
        },
        utterance="山海经吞金兽的三视图，CG风格",
    )
    assert out["kind"] == "success"
    item = out["items"][0]
    assert item.get("pipeline") == "turnaround_image"
    assert item.get("imageAspect") == "2:1"
    assert item.get("resolutionBump") is True


def test_validate_campaign_override_clarify():
    out = validate_parse_result(
        {"confidence": 0.9, "items": [{"target_type": "image", "prompt": "x", "title": "x"}]},
        utterance="帮我做一套营销方案全链路",
    )
    assert out["kind"] == "clarify"
    assert "Campaign" in out["clarify_question"] or "营销" in out["clarify_question"]
