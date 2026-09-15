"""Phase 2a §6.0.1: atomic_generate must not hijack workflow utterances (A1–A8)."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route
from app.graph.route_features import extract_route_features
from app.graph.route_hard import HARD_SHORTCIRCUIT_RULE_IDS, apply_hard_shortcircuit
from app.graph.route_precedence import apply_route_precedence

WORKFLOW = (
    "我期望的工作流不是全都是提示词节点，"
    "我期望通过画布的各类节点骨架连接好直接生图生视频，"
    "提示词自动填入到dock"
)


def test_a1_atomic_generate_not_in_hard_ids():
    assert "atomic_generate" not in HARD_SHORTCIRCUIT_RULE_IDS


def test_a2_workflow_hard_is_none():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    intent = resolve_atomic_intent(WORKFLOW)
    features = extract_route_features(ctx, intent)
    assert apply_hard_shortcircuit(intent, features, ctx) is None


def test_a3_a4_workflow_precedence_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    intent = resolve_atomic_intent(WORKFLOW)
    features = extract_route_features(ctx, intent)
    raw = apply_route_precedence(intent, features, ctx)
    assert raw["flow_mode"] == "canvas_agent"
    assert raw.get("precedence_rule_id") == "default_chat"


def test_a5_workflow_decide_route_default_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_a6_explicit_gen_decide_route_is_canvas_agent():
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我生成一张蓝色天空主图"}]}
    )
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_a7_sibling_ref_backed_kept():
    utt = "@T1 请基于文案生成视频"
    ctx = assemble_route_context({"messages": [{"role": "user", "content": utt}]})
    ctx = {**ctx, "mentioned_keys": ["T1"], "utterance": utt}
    intent = resolve_atomic_intent(utt, mentioned_keys=["T1"])
    features = extract_route_features(ctx, intent)
    raw = apply_route_precedence(intent, features, ctx)
    assert raw.get("precedence_rule_id") == "ref_backed_generate"
    assert raw["flow_mode"] == "canvas_agent"


def test_a8_greeting_is_canvas_agent():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"


def test_a9_run_gen_not_in_tool_plan_visible():
    from app.tools.tool_plan import build_tool_plan

    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names


def test_media_create_high_soft_does_not_force_atomic_route():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": WORKFLOW}]})
    intent = resolve_atomic_intent(WORKFLOW)
    features = extract_route_features(ctx, intent)
    # Soft bit may remain True; route must still be canvas_agent.
    assert features.get("media_create_high") is True
    d = decide_route(ctx, route_llm_primary=False)
    assert d["flow_mode"] == "canvas_agent"
