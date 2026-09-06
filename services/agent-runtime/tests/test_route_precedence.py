"""T14: apply_route_precedence — one test per precedence rule (design §9.9)."""

from __future__ import annotations

import pytest

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features
from app.graph.route_precedence import (
    ROUTE_CLARIFY_MEDIA,
    ROUTE_CLARIFY_MEDIA_NO_SIDEBAR,
    ROUTE_CLARIFY_ORCHESTRATION,
    apply_route_precedence,
)

STYLE3 = "@T1 请按风格3出图"
IMG2IMG = "@I1 模特 @I2 产品，让模特穿上，保持构图不变"


def _decide(state: dict, *, valid_skill_ids: set[str] | None = None, pending=None):
    ctx = assemble_route_context(state)
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    return apply_route_precedence(
        intent,
        features,
        ctx,
        pending_clarify_reply=pending,
        valid_skill_ids=valid_skill_ids,
    )


def test_precedence_modify_existing_plan():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "把模特定妆改为双人模特"}],
            "user_brief": "洁具方案",
            "plan_draft": "# plan",
        }
    )
    assert d["flow_mode"] == "campaign"
    assert d["precedence_rule_id"] == "modify_existing_plan"
    assert d["is_modify"] is True


def test_precedence_regen_no_checkpoint():
    d = _decide({"messages": [{"role": "user", "content": "重新生成一张"}]})
    assert d["flow_mode"] == "clarify_route"
    assert d["precedence_rule_id"] == "regen_no_checkpoint"


def test_precedence_checkpoint_regen():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "重新生成一张"}],
            "atomic_node_id": "node-1",
            "atomic_spec": {"target_type": "image", "prompt": "x", "title": "x"},
        }
    )
    assert d["flow_mode"] == "atomic_regenerate"
    assert d["precedence_rule_id"] == "checkpoint_regen"


def test_precedence_sidebar_img2img():
    d = _decide(
        {
            "messages": [{"role": "user", "content": IMG2IMG}],
            "sidebar_mentioned_keys": ["I1", "I2"],
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://a/1.jpg"},
                {"mediaType": "image", "url": "https://a/2.jpg"},
            ],
        }
    )
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] == "sidebar_img2img"
    assert d["reason"] == "sidebar_img2img_p1"


def test_precedence_product_visual_beats_ref_backed_with_product_photo():
    d = _decide(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "帮我出一套电商推广图：天猫主图、详情图、模特展示图、卖点图、推广海报",
                }
            ],
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "url": "https://cdn.example/p.jpg"}
            ],
        },
        valid_skill_ids={"ecommerce-product-visual"},
    )
    assert d["flow_mode"] == "product_visual"
    assert d["precedence_rule_id"] == "product_visual_intent"


def test_precedence_ref_backed_generate_style3():
    d = _decide(
        {
            "messages": [{"role": "user", "content": STYLE3}],
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
        }
    )
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] == "ref_backed_generate"
    assert d["reason"] == "sidebar_ref_atomic"


def test_precedence_focus_gen():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "快速生成"}],
            "focus_node_id": "image-1",
        }
    )
    assert d["flow_mode"] == "single_node"
    assert d["precedence_rule_id"] == "focus_gen"


def test_precedence_explicit_skill_orch():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "详情页构图方案"}],
            "requested_skill_id": "enterprise-marketing-campaign",
        },
        valid_skill_ids={"enterprise-marketing-campaign"},
    )
    assert d["flow_mode"] == "campaign"
    assert d["precedence_rule_id"] == "explicit_skill_orch"


def test_precedence_orch_ambiguous_ac04():
    """AC-04: orchestration utterance without Skill → clarify_route."""
    d = _decide({"messages": [{"role": "user", "content": "天猫蓝牙耳机详情页营销方案"}]})
    assert d["flow_mode"] == "clarify_route"
    assert d["precedence_rule_id"] == "orch_ambiguous"
    assert d["clarify_question"] == ROUTE_CLARIFY_ORCHESTRATION


def test_precedence_explore():
    d = _decide(
        {"messages": [{"role": "user", "content": "看看画布上有哪些节点，状态怎么样？"}]}
    )
    assert d["flow_mode"] == "explore_canvas"
    assert d["precedence_rule_id"] == "explore"


def test_precedence_atomic_generate():
    d = _decide({"messages": [{"role": "user", "content": "帮我生成一张蓝牙耳机主图"}]})
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] == "atomic_generate"


def test_precedence_empty():
    d = _decide({"messages": [{"role": "user", "content": "   "}]})
    assert d["flow_mode"] == "chat"
    assert d["precedence_rule_id"] == "empty"


def test_precedence_default_chat():
    d = _decide({"messages": [{"role": "user", "content": "你好"}]})
    assert d["flow_mode"] == "chat"
    assert d["precedence_rule_id"] == "default_chat"


def test_precedence_clarify_resume():
    pending = classify_clarify_reply(
        STYLE3,
        ROUTE_CLARIFY_ORCHESTRATION,
        "1",
    )
    d = _decide(
        {
            "messages": [{"role": "user", "content": "1"}],
            "sidebar_mentioned_keys": ["T1"],
        },
        pending=pending,
    )
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] == "clarify_resume"


def test_sheng_xiao_girl_not_default_chat():
    d = _decide({"messages": [{"role": "user", "content": "请帮我生一个小女孩的图片"}]})
    assert d["flow_mode"] != "chat"
    assert d["precedence_rule_id"] != "default_chat"
    assert d["flow_mode"] in ("atomic_create", "clarify_route")


def test_sheng_xiao_girl_prefers_atomic_when_high():
    d = _decide({"messages": [{"role": "user", "content": "请帮我生一个小女孩的图片"}]})
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] in ("atomic_generate", "media_create_high")


def test_generate_zhi_dongbei_hu_atomic():
    """Prod case: 生成一只…图片 must not fall to chat (classifier 只 ≠ 张/个)."""
    d = _decide(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "生成一只东北虎图片，卡通版，戴着红围巾、正在笑、或者背景是雪地",
                }
            ]
        }
    )
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] != "default_chat"


def test_generate_dongbei_hu_without_classifier_atomic():
    d = _decide({"messages": [{"role": "user", "content": "生成东北虎图片"}]})
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] != "default_chat"


@pytest.mark.parametrize(
    "utterance",
    [
        "生活怎么样",
        "生意很好",
        "先生这张图不错",
        "产生了很多图表",
        "卫生间的示意图在哪",
        "学生画的图我看不懂",
        "整个图表看起来不错",
        "来个图书推荐",
        "请帮我生一个图书推荐",
        "请帮我生一个图表分析",
    ],
)
def test_casual_chat_not_hijacked_by_media_create(utterance: str):
    d = _decide({"messages": [{"role": "user", "content": utterance}]})
    assert d["flow_mode"] == "chat"
    assert d["precedence_rule_id"] == "default_chat"


def test_vision_qa_with_sidebar_not_chat():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "这个图片是什么？"}],
            "sidebar_attachments": [
                {"refKey": "I1", "mediaType": "image", "url": "https://a/1.jpg"}
            ],
        }
    )
    assert d["flow_mode"] != "chat"
    assert d["precedence_rule_id"] != "default_chat"
    assert d["flow_mode"] in ("clarify_route", "atomic_create")
    if d["flow_mode"] == "clarify_route":
        assert d["clarify_question"] == ROUTE_CLARIFY_MEDIA


def test_vision_qa_without_sidebar_routes_to_media_clarify():
    for utterance in ("这个图片是什么？", "看看这张图"):
        d = _decide({"messages": [{"role": "user", "content": utterance}]})
        assert d["flow_mode"] == "clarify_route"
        assert d["precedence_rule_id"] == "suspected_vision_clarify"
        assert d["clarify_question"] == ROUTE_CLARIFY_MEDIA_NO_SIDEBAR
        assert "解读侧栏图片" not in d["clarify_question"]


def test_sidebar_media_question_not_chat():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "这是什么？"}],
            "sidebar_attachments": [
                {"refKey": "I1", "mediaType": "image", "url": "https://a/1.jpg"}
            ],
        }
    )
    assert d["flow_mode"] == "clarify_route"
    assert d["precedence_rule_id"] == "sidebar_media_question"
    assert d["clarify_question"] == ROUTE_CLARIFY_MEDIA
    assert "解读侧栏图片" in d["clarify_question"]


def test_bare_question_without_sidebar_media_stays_chat():
    d = _decide({"messages": [{"role": "user", "content": "这是什么？"}]})
    assert d["flow_mode"] == "chat"
    assert d["precedence_rule_id"] == "default_chat"


def test_soft_suspected_clarify_uses_media_question():
    d = _decide({"messages": [{"role": "user", "content": "帮我弄张图看看"}]})
    assert d["precedence_rule_id"] != "default_chat"
    if d["flow_mode"] == "clarify_route":
        assert "1）" in (d.get("clarify_question") or "")
