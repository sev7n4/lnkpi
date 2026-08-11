"""UX-PV-08: user_request_labels extraction from utterance."""

from __future__ import annotations

from app.graph.product_visual_v2.utterance import extract_user_request_labels


def test_user_request_labels_from_grape_utterance():
    labels = extract_user_request_labels("…礼盒好看…快递防压…有人送人")
    assert len(labels) >= 2
    assert any("礼盒" in x for x in labels)


def test_user_request_labels_empty_utterance():
    assert extract_user_request_labels("") == []
    assert extract_user_request_labels("   ") == []


def test_user_request_labels_comma_separated():
    labels = extract_user_request_labels("巨峰葡萄礼盒，快递防压结构，有人送人场景")
    assert len(labels) >= 2
    assert any("礼盒" in x or "葡萄" in x for x in labels)
    assert any("防压" in x or "快递" in x for x in labels)
