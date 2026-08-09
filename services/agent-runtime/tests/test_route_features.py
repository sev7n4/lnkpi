"""T13: RouteFeatures extraction from RouteContext + AtomicIntent."""

from __future__ import annotations

import pytest

from app.graph.atomic_intent_ir import AtomicIntent, resolve_atomic_intent
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features

STYLE3 = "@T1 请按风格3出图"


def _intent(text: str, *, keys: list[str] | None = None) -> AtomicIntent:
    return resolve_atomic_intent(text, mentioned_keys=keys)


def test_style3_ctx_has_text_ref_not_orchestration_phrases():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": STYLE3}],
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
        }
    )
    intent = _intent(STYLE3, keys=["T1"])
    features = extract_route_features(ctx, intent)
    assert features["has_text_ref"] is True
    assert features["orchestration_phrases"] is False
    assert features["has_image_ref"] is False


def test_img2img_multi_image_ref():
    utterance = "@I1 模特 @I2 产品，让模特穿上"
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": utterance}],
            "sidebar_mentioned_keys": ["I1", "I2"],
        }
    )
    intent = _intent(utterance, keys=["I1", "I2"])
    features = extract_route_features(ctx, intent)
    assert features["has_multi_image_ref"] is True
    assert features["has_image_ref"] is True


def test_orchestration_phrases_without_single_chutu():
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我做天猫详情页营销方案"}]}
    )
    intent = _intent("帮我做天猫详情页营销方案")
    features = extract_route_features(ctx, intent)
    assert features["orchestration_phrases"] is True


def test_chutu_alone_not_orchestration_phrase():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": STYLE3}]})
    intent = _intent(STYLE3, keys=["T1"])
    features = extract_route_features(ctx, intent)
    assert features["orchestration_phrases"] is False


def test_explicit_skill_feature():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": "详情页方案"}],
            "requested_skill_id": "enterprise-marketing-campaign",
        }
    )
    intent = _intent("详情页方案")
    features = extract_route_features(ctx, intent)
    assert features["explicit_skill"] is True


def test_atomic_checkpoint_feature():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": "重新生成一张"}],
            "atomic_node_id": "node-1",
            "atomic_spec": {"target_type": "image", "prompt": "x", "title": "x"},
        }
    )
    intent = _intent("重新生成一张")
    features = extract_route_features(ctx, intent)
    assert features["has_atomic_checkpoint"] is True


def test_modality_conflict_risk_planning_detail_page():
    utterance = "请你帮我设计蓝牙耳机主图，详情页的构图方案"
    ctx = assemble_route_context({"messages": [{"role": "user", "content": utterance}]})
    intent = _intent(utterance)
    features = extract_route_features(ctx, intent)
    assert features["modality_conflict_risk"] is True


def test_preserve_composition_feature():
    utterance = "保持主图风格、背景、构图不变，生成换装图"
    ctx = assemble_route_context({"messages": [{"role": "user", "content": utterance}]})
    intent = _intent(utterance)
    features = extract_route_features(ctx, intent)
    assert features["preserve_composition"] is True
