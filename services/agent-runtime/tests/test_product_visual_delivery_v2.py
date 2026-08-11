"""Phase 4 delivery v2 — shot_id grouping (P4-DEL-*)."""

from __future__ import annotations

import pytest

from app.graph.product_visual_v2.delivery import (
    apply_delivery_decision_v2,
    build_delivery_selections_v2,
    build_delivery_summary_state,
    validate_delivery_confirm_v2,
    variant_keys_for_shot,
)


SHOATS = [
    {
        "shot_id": "packaging_hero__1",
        "type_id": "packaging_hero",
        "label": "包装主视觉",
        "macro_scheme_id": "A",
        "variant_count": 2,
    },
    {
        "shot_id": "packaging_structure__1",
        "type_id": "packaging_structure",
        "label": "结构图",
        "macro_scheme_id": "A",
        "variant_count": 1,
    },
    {
        "shot_id": "model_holding_pack__1",
        "type_id": "model_holding_pack",
        "label": "模特送礼",
        "macro_scheme_id": "B",
        "variant_count": 1,
    },
]


def test_delivery_selections_keys_are_shot_id_p4_del_001():
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1"},
        "packaging_hero__1__v2": {"url": "u2"},
        "packaging_structure__1": {"url": "u3"},
        "model_holding_pack__1": {"url": "u4"},
    }
    selections = build_delivery_selections_v2(SHOATS, gen_by_key)
    assert set(selections.keys()) == {
        "packaging_hero__1",
        "packaging_structure__1",
        "model_holding_pack__1",
    }


def test_variant_keys_for_shot_multi():
    keys = variant_keys_for_shot(SHOATS[0])
    assert keys == ["packaging_hero__1__v1", "packaging_hero__1__v2"]


def test_validate_delivery_confirm_v2_all_ready():
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1"},
        "packaging_structure__1": {"url": "u3"},
        "model_holding_pack__1": {"url": "u4"},
    }
    selections = build_delivery_selections_v2(SHOATS, gen_by_key)
    ok, err = validate_delivery_confirm_v2(SHOATS, selections, gen_by_key)
    assert ok is True
    assert err == ""


def test_validate_delivery_confirm_v2_missing_shot():
    gen_by_key = {"packaging_hero__1__v1": {"url": "u1"}}
    selections = {"packaging_hero__1": "packaging_hero__1__v1"}
    ok, err = validate_delivery_confirm_v2(SHOATS, selections, gen_by_key)
    assert ok is False
    assert "未完成" in err


@pytest.mark.asyncio
async def test_apply_switch_variant_no_regen_p4_del_003():
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1"},
        "packaging_hero__1__v2": {"url": "u2"},
    }
    state = {
        "shot_manifest": [SHOATS[0]],
        "gen_by_key": gen_by_key,
        "gen_completed_keys": list(gen_by_key.keys()),
        "delivery_selections": {"packaging_hero__1": "packaging_hero__1__v1"},
        "split_manifest": [],
    }
    out = apply_delivery_decision_v2(
        state,
        {
            "action": "switch_scheme",
            "type_id": "packaging_hero__1",
            "scheme_id": "packaging_hero__1__v2",
        },
    )
    assert out["delivery_selections"]["packaging_hero__1"] == "packaging_hero__1__v2"
    assert out["phase"] == "await_delivery_confirm"
    assert "gen_ordered_keys" not in out


def test_build_delivery_summary_state_phase():
    state = {
        "shot_manifest": SHOATS,
        "gen_by_key": {
            "packaging_hero__1__v1": {"url": "u1"},
            "packaging_structure__1": {"url": "u3"},
            "model_holding_pack__1": {"url": "u4"},
        },
        "gen_completed_keys": [
            "packaging_hero__1__v1",
            "packaging_structure__1",
            "model_holding_pack__1",
        ],
    }
    out = build_delivery_summary_state(state)
    assert out["phase"] == "await_delivery_confirm"
    assert "packaging_hero__1" in out["delivery_selections"]


def test_confirm_delivery_one_url_per_shot_p4_del_002():
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1"},
        "packaging_hero__1__v2": {"url": "u2"},
        "packaging_structure__1": {"url": "u3"},
        "model_holding_pack__1": {"url": "u4"},
    }
    state = {
        "shot_manifest": SHOATS,
        "gen_by_key": gen_by_key,
        "gen_completed_keys": list(gen_by_key.keys()),
        "split_manifest": [],
    }
    selections = build_delivery_selections_v2(SHOATS, gen_by_key)
    out = apply_delivery_decision_v2(
        state,
        {"action": "confirm_delivery", "selections": selections},
    )
    assert out["phase"] == "done"
    assert len(out["delivery_selections"]) == 3
    for shot_id, variant_key in out["delivery_selections"].items():
        assert gen_by_key[variant_key]["url"]
