from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route

PROD = (
    "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。"
    "保持主图风格，背景，构图不变。"
)


def test_assemble_includes_sidebar_fields():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "@I1 @I2 穿上"}],
        "sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}],
        "sidebar_mentioned_keys": ["I1", "I2"],
        "requested_skill_id": "",
    })
    assert ctx["mentioned_keys"] == ["I1", "I2"]
    assert len(ctx["sidebar_attachments"]) == 1


def test_p1_sidebar_img2img_atomic():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": PROD}],
        "sidebar_mentioned_keys": ["I1", "I2"],
        "sidebar_attachments": [
            {"mediaType": "image", "url": "https://a/1.jpg"},
            {"mediaType": "image", "url": "https://a/2.jpg"},
        ],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "atomic_create"
    assert d["reason"] == "sidebar_img2img_p1"
    assert d["confidence"] >= 0.9


def test_no_skill_marketing_clarify():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "天猫蓝牙耳机详情页营销方案"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "clarify_route"
    q = d.get("clarify_question") or ""
    assert "skill" in q.lower() or "出图" in q or "编排" in q


def test_explicit_skill_orchestration():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "详情页构图方案"}],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    d = decide_route(ctx, valid_skill_ids={"enterprise-marketing-campaign"})
    assert d["flow_mode"] == "campaign"


def test_prod_utterance_atomic_without_attachments():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": PROD}]})
    d = decide_route(ctx)
    assert d["flow_mode"] == "atomic_create"


def test_sidebar_t1_style3_atomic():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "@T1 请按风格3出图"}],
        "sidebar_mentioned_keys": ["T1"],
        "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "atomic_create"
    assert d["reason"] == "sidebar_ref_atomic"
