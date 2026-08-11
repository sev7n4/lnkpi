"""Phase 4 delivery v2 — shot_id grouping (P4-DEL-*)."""

from __future__ import annotations

import pytest

from app.graph.product_visual_v2.delivery import (
    apply_delivery_decision_v2,
    build_delivery_groups,
    build_delivery_presentation_patch,
    build_delivery_selections_v2,
    build_delivery_summary_state,
    build_done_presentation,
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
        "user_request_labels": ["礼盒主视觉", "结构防压", "送礼场景"],
    }
    out = build_delivery_summary_state(state)
    assert out["phase"] == "await_delivery_confirm"
    assert "packaging_hero__1" in out["delivery_selections"]
    assert out["presentation"]["kind"] == "delivery_cards"
    groups = out["presentation"]["body"]["groups"]
    assert groups[0]["label"] == "礼盒主视觉"
    assert groups[0]["subtitle"] == "[方案A] 包装主视觉"


def test_build_delivery_groups_subtitle_macro():
    state = {
        "user_request_labels": ["快递防压"],
        "shot_manifest": [SHOATS[1]],
        "gen_by_key": {"packaging_structure__1": {"url": "u3"}},
        "gen_completed_keys": ["packaging_structure__1"],
    }
    groups = build_delivery_groups(state)
    assert len(groups) == 1
    assert groups[0]["subtitle"] == "[方案A] 结构图"


def test_build_delivery_presentation_patch_footer_count():
    state = {
        "shot_manifest": SHOATS,
        "user_request_labels": ["a", "b", "c"],
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
    patch = build_delivery_presentation_patch(state)
    assert patch["expected_delivery_count"] == 3
    assert "3" in patch["presentation"]["body"]["footer_hint"]


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


def test_build_done_presentation_delivery_summary_table():
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1", "node_id": "node-hero"},
        "packaging_structure__1": {"url": "u3", "node_id": "node-structure"},
        "model_holding_pack__1": {"url": "u4", "node_id": "node-gift"},
        "white_bg_seed": {"url": "u0", "node_id": "node-seed"},
    }
    state = {
        "shot_manifest": SHOATS,
        "delivery_selections": build_delivery_selections_v2(SHOATS, gen_by_key),
        "gen_by_key": gen_by_key,
        "split_manifest": [
            {"key": "white_bg_seed", "title": "白底主图", "role": "seed", "node_id": "node-seed"},
            {"key": "turnaround", "title": "四视图", "role": "turnaround", "node_id": "node-turn"},
        ],
        "visual_intent": {"primary_goal": "巨峰葡萄礼盒主视觉与送礼场景"},
        "effective_utterance": "巨峰葡萄礼盒主视觉与送礼场景",
        "user_request_labels": ["礼盒长什么样", "快递防压", "有人送人"],
    }
    pres = build_done_presentation(state)
    assert pres["kind"] == "delivery_summary_table"
    assert "巨峰葡萄" in pres["body"]["headline"]
    assert len(pres["body"]["finalized"]) == 3
    assert pres["body"]["finalized"][0]["title"] == "礼盒长什么样"
    assert pres["body"]["finalized"][0]["macro"] == "A"
    assert pres["body"]["finalized"][0]["node_id"] == "node-hero"
    assert len(pres["body"]["basics"]) == 2
    assert pres["primary_action"]["label"] == "在画布中定位全部"
    assert pres["primary_action"]["message"] == "__focus_all_canvas__"
    assert "成功" not in pres["body"]["headline"]


@pytest.mark.asyncio
async def test_done_node_product_visual_v2_uses_delivery_summary():
    from app.graph.nodes.done import make_done_node

    done = make_done_node()
    gen_by_key = {
        "packaging_hero__1__v1": {"url": "u1", "node_id": "node-hero"},
        "packaging_structure__1": {"url": "u3", "node_id": "node-structure"},
        "model_holding_pack__1": {"url": "u4", "node_id": "node-gift"},
    }
    selections = build_delivery_selections_v2(SHOATS, gen_by_key)
    out = await done(
        {
            "flow_mode": "product_visual",
            "product_visual_scheme_v2": True,
            "shot_manifest": SHOATS,
            "delivery_selections": selections,
            "gen_by_key": gen_by_key,
            "split_manifest": [],
            "visual_intent": {"primary_goal": "巨峰葡萄礼盒"},
        }
    )
    assert out["phase"] == "done"
    assert out["presentation"]["kind"] == "delivery_summary_table"
    assert "巨峰葡萄" in out["messages"][0].content
    assert "成功" not in out["messages"][0].content
    assert "失败" not in out["messages"][0].content
