"""Phase 2d §6.0.6: V6 close competing atomic_create routes (F1–F4 / F3b)."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.decide_lane import (
    ALLOWED_LANES,
    DecideLaneResult,
    apply_decide_lane_postprocess,
    parse_decide_lane_json,
)
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features
from app.graph.route_precedence import ROUTE_CLARIFY_ORCHESTRATION, apply_route_precedence
from app.graph.route_decide import decide_route

STYLE3 = "@T1 请按风格3出图"
IMG2IMG = "@I1 模特 @I2 产品，让模特穿上，保持构图不变"


def _precedence(state: dict, *, pending=None):
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
    )


def test_f1_sidebar_img2img_routes_canvas_agent():
    d = _precedence(
        {
            "messages": [{"role": "user", "content": IMG2IMG}],
            "sidebar_mentioned_keys": ["I1", "I2"],
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://a/1.jpg"},
                {"mediaType": "image", "url": "https://a/2.jpg"},
            ],
        }
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "sidebar_img2img"


def test_f2_ref_backed_generate_routes_canvas_agent():
    d = _precedence(
        {
            "messages": [{"role": "user", "content": STYLE3}],
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
        }
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "ref_backed_generate"


def test_f3_clarify_resume_legacy_atomic_route_maps_canvas_agent():
    """Historical pending with route=atomic_create must not reopen atomic path."""
    pending = {
        "action": "generate",
        "scope": "atomic",
        "route": "atomic_create",
        "structure": "single",
        "items": [],
        "confidence": 0.9,
        "needs_clarify": False,
        "reason": "legacy",
    }
    d = _precedence(
        {"messages": [{"role": "user", "content": "1"}]},
        pending=pending,
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "clarify_resume"


def test_f3b_clarify_reply_writes_canvas_agent_not_atomic_create():
    out = classify_clarify_reply(
        STYLE3,
        ROUTE_CLARIFY_ORCHESTRATION,
        "1",
    )
    assert out != "none"
    assert isinstance(out, dict)
    assert out["route"] == "canvas_agent"

    campaign = classify_clarify_reply(
        "天猫方案",
        ROUTE_CLARIFY_ORCHESTRATION,
        "2",
    )
    assert isinstance(campaign, dict)
    assert campaign["route"] == "campaign"


def test_f4_decide_lane_disallows_and_maps_atomic_create():
    assert "atomic_create" not in ALLOWED_LANES
    mapped = parse_decide_lane_json(
        '{"lane":"atomic_create","confidence":0.9,"reason":"legacy_llm"}'
    )
    assert mapped is not None
    assert mapped["lane"] == "canvas_agent"
    post = apply_decide_lane_postprocess(
        DecideLaneResult(lane="atomic_create", confidence=0.9, reason="x", clarify_question=None)
    )
    assert post["lane"] == "canvas_agent"


def test_f5_bare_gen_still_canvas_agent():
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我生成一张蓝色天空产品主图"}]}
    )
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_f6_run_gen_not_visible():
    from app.tools.tool_plan import build_tool_plan

    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
