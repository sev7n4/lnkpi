"""Sidebar copy template tests."""

from __future__ import annotations

from app.graph.atomic_parse_schema import parse_outcome_to_state
from app.graph.sidebar_copy import (
    format_atomic_create_progress,
    format_atomic_parse_ack,
    topic_switch_prefix,
)


def test_parse_outcome_user_message_excludes_canvas_context():
    state = parse_outcome_to_state(
        {
            "kind": "success",
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "prompt": "山海经的神兽的三视图",
                    "title": "山海经的神兽的三视图",
                    "confirm_gate": False,
                    "pipeline": "turnaround_image",
                }
            ],
            "confidence": 0.95,
            "reason": "test",
        },
        canvas_context="上轮原子:prompt:蓝牙耳机 | 近期对话:用户:营销方案",
    )
    msg = state["messages"][0].content
    assert "原子创作" not in msg
    assert "canvas_context" not in msg
    assert "蓝牙耳机" not in msg
    assert "近期对话" not in msg
    assert "角色设定图" in msg
    assert state["atomic_spec"].get("canvas_context")


def test_turnaround_note_only_on_create_progress():
    spec = {
        "target_type": "image",
        "title": "山海经的神兽的三视图",
        "pipeline": "turnaround_image",
    }
    ack = format_atomic_parse_ack(spec)
    progress = format_atomic_create_progress(spec)
    assert "近景特写" not in ack
    assert "近景特写" in progress


def test_topic_switch_prefix():
    assert topic_switch_prefix("蓝牙耳机三视图", "山海经神兽三视图").startswith("已按你的新需求处理")
    assert topic_switch_prefix("山海经神兽三视图", "山海经神兽三视图扩展") == ""


def test_video_confirm_gate_copy():
    spec = {
        "target_type": "video",
        "title": "15秒产品展示",
        "confirm_gate": True,
    }
    msg = format_atomic_parse_ack(spec)
    assert "提交前需你确认" in msg
