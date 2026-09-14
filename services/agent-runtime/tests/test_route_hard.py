"""M3a: Appendix A hard short-circuit rule ids + runner."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features
from app.graph.route_hard import HARD_SHORTCIRCUIT_RULE_IDS, apply_hard_shortcircuit
from app.graph.route_precedence import PRECEDENCE_RULES

# Appendix A ordered hard ids (exclude explore / empty / default_chat).
_APPENDIX_A_HARD_IDS = (
    "modify_existing_plan",
    "regen_no_checkpoint",
    "sidebar_img2img",
    "checkpoint_regen",
    "product_visual_explicit",
    "product_visual_intent",
    "ref_backed_generate",
    "focus_gen",
    "explicit_skill_orch",
    "orch_ambiguous",
    "atomic_generate",
    "suspected_vision_clarify",
    "suspected_media_clarify",
    "sidebar_media_question",
)


def test_explore_not_in_hard_ids():
    assert "explore" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "empty" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "default_chat" not in HARD_SHORTCIRCUIT_RULE_IDS
    assert "atomic_generate" in HARD_SHORTCIRCUIT_RULE_IDS


def test_hard_ids_match_appendix_a_order():
    assert HARD_SHORTCIRCUIT_RULE_IDS == _APPENDIX_A_HARD_IDS


def test_hard_ids_are_subset_of_precedence_in_order():
    precedence_ids = [rule_id for rule_id, _ in PRECEDENCE_RULES]
    hard_positions = [precedence_ids.index(rid) for rid in HARD_SHORTCIRCUIT_RULE_IDS]
    assert hard_positions == sorted(hard_positions)


def _hard(state: dict, *, valid_skill_ids: set[str] | None = None):
    ctx = assemble_route_context(state)
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    return apply_hard_shortcircuit(
        intent,
        features,
        ctx,
        valid_skill_ids=valid_skill_ids,
    )


def test_hard_hits_atomic_generate():
    d = _hard({"messages": [{"role": "user", "content": "帮我生成一张蓝牙耳机主图"}]})
    assert d is not None
    assert d["precedence_rule_id"] == "atomic_generate"
    assert d["flow_mode"] == "atomic_create"


def test_hard_skips_explore_noun_signal():
    """Explore noun hits must not short-circuit; leave for decide_lane / canvas_agent."""
    d = _hard(
        {"messages": [{"role": "user", "content": "看看画布上有哪些节点，状态怎么样？"}]}
    )
    assert d is None


def test_hard_skips_empty_utterance():
    d = _hard({"messages": [{"role": "user", "content": ""}]})
    assert d is None


def test_hard_skips_default_chat_sink():
    d = _hard({"messages": [{"role": "user", "content": "你好"}]})
    assert d is None
