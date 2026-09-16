"""L0 composition_confirm / composition_structure beat img2img / orch."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.composition_route import GOLD_COMPOSE_1
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route
from app.graph.route_features import extract_route_features
from app.graph.route_hard import apply_hard_shortcircuit
from app.graph.route_precedence import PRECEDENCE_RULES, apply_route_precedence

# 请 + three images, no structure keywords — existing IMG2IMG fixture style.
THREE_IMG_QING = "@I1 模特 @I2 @I3 产品，请让模特穿上，保持构图不变"


def _gold_state() -> dict:
    return {
        "messages": [{"role": "user", "content": GOLD_COMPOSE_1}],
        "sidebar_mentioned_keys": ["I1", "I2", "I3"],
        "sidebar_attachments": [
            {"mediaType": "image", "url": "https://a/1.jpg"},
            {"mediaType": "image", "url": "https://a/2.jpg"},
            {"mediaType": "image", "url": "https://a/3.jpg"},
        ],
    }


def _decide(state: dict, *, valid_skill_ids: set[str] | None = None):
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
        valid_skill_ids=valid_skill_ids,
    )


def test_composition_rules_immediately_after_regen_no_checkpoint():
    ids = [rule_id for rule_id, _ in PRECEDENCE_RULES]
    i = ids.index("regen_no_checkpoint")
    assert ids[i + 1] == "composition_confirm"
    assert ids[i + 2] == "composition_structure"
    assert ids[i + 3] == "sidebar_img2img"


def test_gold_l0_wins_over_img2img_and_orch():
    state = _gold_state()
    ctx = assemble_route_context(state)
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    assert ctx["mentioned_keys"] == ["I1", "I2", "I3"]
    assert features["has_multi_image_ref"] is True
    d = apply_route_precedence(intent, features, ctx)
    assert d["precedence_rule_id"] == "composition_structure"
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] not in {
        "sidebar_img2img",
        "product_visual_intent",
        "ref_backed_generate",
        "orch_ambiguous",
    }


def test_gold_hard_shortcircuit_wins_when_llm_primary():
    ctx = assemble_route_context(_gold_state())
    d = decide_route(ctx, route_llm_primary=True)
    assert d["precedence_rule_id"] == "composition_structure"
    assert d["flow_mode"] == "canvas_agent"


def test_gold_apply_hard_shortcircuit():
    ctx = assemble_route_context(_gold_state())
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    d = apply_hard_shortcircuit(intent, features, ctx)
    assert d is not None
    assert d["precedence_rule_id"] == "composition_structure"
    assert d["flow_mode"] == "canvas_agent"


def test_confirm_chip_routes_composition_confirm():
    d = _decide({"messages": [{"role": "user", "content": "确认落到画布"}]})
    assert d["precedence_rule_id"] == "composition_confirm"
    assert d["flow_mode"] == "canvas_agent"


def test_cancel_chip_routes_composition_confirm():
    d = _decide({"messages": [{"role": "user", "content": "先不改"}]})
    assert d["precedence_rule_id"] == "composition_confirm"
    assert d["flow_mode"] == "canvas_agent"


def test_confirm_chip_wins_over_pending_structure():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "确认落到画布"}],
            "composition_pending": '{"identityRef":"I1"}',
        }
    )
    assert d["precedence_rule_id"] == "composition_confirm"


def test_qing_three_images_without_structure_stays_img2img():
    d = _decide(
        {
            "messages": [{"role": "user", "content": THREE_IMG_QING}],
            "sidebar_mentioned_keys": ["I1", "I2", "I3"],
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://a/1.jpg"},
                {"mediaType": "image", "url": "https://a/2.jpg"},
                {"mediaType": "image", "url": "https://a/3.jpg"},
            ],
        }
    )
    assert d["precedence_rule_id"] == "sidebar_img2img"
    assert d["flow_mode"] == "canvas_agent"


def test_pending_composition_routes_structure_without_keywords():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "继续刚才那个"}],
            "composition_pending": '{"identityRef":"I1"}',
        }
    )
    assert d["precedence_rule_id"] == "composition_structure"
    assert d["flow_mode"] == "canvas_agent"


def test_assemble_copies_composition_pending():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": "x"}],
            "composition_pending": '{"a":1}',
        }
    )
    assert ctx.get("composition_pending") == '{"a":1}'


def _stale_pending() -> str:
    return json.dumps(
        {
            "utterance": "作为模特换装，服装图",
            "ts": (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat(),
        }
    )


def test_stale_pending_does_not_route_structure():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "继续刚才那个"}],
            "composition_pending": _stale_pending(),
        }
    )
    assert d["precedence_rule_id"] != "composition_structure"


def test_pending_plus_qing_tryon_stays_img2img():
    d = _decide(
        {
            "messages": [{"role": "user", "content": THREE_IMG_QING}],
            "composition_pending": '{"identityRef":"I1"}',
            "sidebar_mentioned_keys": ["I1", "I2", "I3"],
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://a/1.jpg"},
                {"mediaType": "image", "url": "https://a/2.jpg"},
                {"mediaType": "image", "url": "https://a/3.jpg"},
            ],
        }
    )
    assert d["precedence_rule_id"] == "sidebar_img2img"


def test_pending_plus_chat_does_not_route_structure():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "你好"}],
            "composition_pending": '{"identityRef":"I1"}',
        }
    )
    assert d["precedence_rule_id"] != "composition_structure"


def test_pending_plus_bare_generate_does_not_route_structure():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "生成一张猫"}],
            "composition_pending": '{"identityRef":"I1"}',
        }
    )
    assert d["precedence_rule_id"] != "composition_structure"


def test_pending_bare_i_assignment_routes_structure():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "I1 模特 I2 I3 服装"}],
            "composition_pending": '{"utterance":"作为模特换装，服装图"}',
        }
    )
    assert d["precedence_rule_id"] == "composition_structure"
    assert d["flow_mode"] == "canvas_agent"
