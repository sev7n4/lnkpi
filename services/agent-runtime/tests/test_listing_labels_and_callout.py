"""Tests for listing label extraction and macro shot-limit callout."""

from __future__ import annotations

from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import build_presentation_envelope
from app.graph.product_visual_v2.utterance import extract_user_request_labels

CRAB_UTTERANCE = (
    "用这张产品实拍图出电商标准的出图方案，需要至少包括：主图、详情页、模特展示场景图、"
    "营销海报、产品细节图、物流包装图；价格为：108元/3只，平均3两一只。产地：鄱阳湖。"
)


def test_extract_user_request_labels_crab_listing_six_types():
    labels = extract_user_request_labels(CRAB_UTTERANCE)
    assert len(labels) == 6
    assert "主图" in labels
    assert "详情页" in labels
    assert "模特展示场景图" in labels
    assert "营销海报" in labels
    assert "产品细节图" in labels
    assert "物流包装图" in labels


def test_macro_presentation_shot_limit_callout_at_six_labels():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    labels = extract_user_request_labels(CRAB_UTTERANCE)
    pres = build_presentation_envelope(
        kind="macro_scheme_cards",
        phase="await_macro_scheme_select",
        state={
            "user_request_labels": labels,
            "macro_schemes": [{"id": "A", "label": "A", "summary": "s", "recommended": True}],
        },
        copy=copy,
    )
    assert pres["body"].get("callout_shot_limit")
    assert "6" in pres["body"]["callout_shot_limit"]
