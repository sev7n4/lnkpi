"""Sidebar copy with sidebar attachment ref keys."""

from __future__ import annotations

from app.graph.atomic_parse_schema import parse_outcome_to_state
from app.graph.sidebar_attachments import assign_sidebar_ref_keys
from app.graph.sidebar_copy import format_atomic_parse_ack


def test_assign_ref_keys_matches_frontend_order():
    attachments = [
        {
            "id": "1",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "a",
            "url": "https://x/1.jpg",
        },
        {
            "id": "2",
            "mediaType": "text",
            "sourceKind": "upload",
            "label": "b",
            "text": "卖点",
        },
    ]
    assert assign_sidebar_ref_keys(attachments) == ["I1", "T1"]


def test_parse_ack_mentions_single_ref():
    spec = {
        "target_type": "image",
        "title": "产品三视图",
        "confirm_gate": False,
    }
    msg = format_atomic_parse_ack(spec, ref_keys=["I1"])
    assert "@I1" in msg
    assert "参考" in msg
    assert "产品三视图" in msg
    assert "好的，我会参考你提供的 @I1，生成产品三视图。" == msg


def test_parse_ack_mentions_multiple_refs():
    spec = {
        "target_type": "image",
        "title": "蓝牙耳机主图",
        "confirm_gate": False,
    }
    msg = format_atomic_parse_ack(spec, ref_keys=["I1", "T1"])
    assert "@I1" in msg
    assert "@T1" in msg
    assert "我会参考你提供的 @I1、@T1" in msg


def test_parse_outcome_ack_includes_attachment_refs():
    attachments = [
        {
            "id": "1",
            "mediaType": "image",
            "sourceKind": "upload",
            "label": "ref",
            "url": "https://x/ref.jpg",
        }
    ]
    state = parse_outcome_to_state(
        {
            "kind": "success",
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "prompt": "按参考图生成产品三视图",
                    "title": "产品三视图",
                    "confirm_gate": False,
                }
            ],
            "confidence": 0.95,
            "reason": "test",
        },
        sidebar_attachments=attachments,
    )
    msg = state["messages"][0].content
    assert "@I1" in msg
    assert "参考" in msg


def test_parse_ack_without_refs_unchanged():
    spec = {
        "target_type": "image",
        "title": "产品三视图",
        "confirm_gate": False,
    }
    msg = format_atomic_parse_ack(spec)
    assert msg == "好的，我来生成图片「产品三视图」。"
