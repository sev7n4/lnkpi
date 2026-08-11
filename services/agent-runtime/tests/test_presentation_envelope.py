"""P0-0: product_visual presentation envelope foundation."""

from __future__ import annotations

from app.graph.hitl_resume import interrupt_event_payload
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import (
    build_context_recap,
    build_presentation_envelope,
    compute_expected_delivery,
    phase_to_stepper,
)


def test_envelope_has_kind_stepper_context_recap():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    env = build_presentation_envelope(
        kind="callout_info",
        phase="await_image_qa",
        state={
            "visual_intent": {"primary_goal": "巨峰葡萄礼盒"},
            "route_context": {"utterance": "帮我做巨峰葡萄礼盒主视觉"},
        },
        copy=copy,
    )
    assert env["kind"] == "callout_info"
    assert env["stepper"]["current"] == "image_qa"
    assert env["stepper"]["completed"] == []
    assert "context_recap" in env
    assert len(env["context_recap"]) <= 120
    assert "巨峰葡萄礼盒" in env["context_recap"]


def test_phase_to_stepper_maps_await_gates():
    assert phase_to_stepper("await_image_qa") == "image_qa"
    assert phase_to_stepper("await_macro_scheme_select") == "macro_select"
    assert phase_to_stepper("await_shot_confirm") == "shot_plan"
    assert phase_to_stepper("await_topo") == "topo_preview"
    assert phase_to_stepper("await_delivery_confirm") == "delivery"
    assert phase_to_stepper("done") == "done"


def test_stepper_completed_before_current():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    env = build_presentation_envelope(
        kind="macro_scheme_cards",
        phase="await_macro_scheme_select",
        state={"visual_intent": {"primary_goal": "礼盒"}, "route_context": {}},
        copy=copy,
    )
    assert env["stepper"]["current"] == "macro_select"
    assert env["stepper"]["completed"] == ["image_qa", "scheme_draft"]


def test_product_visual_copy_get_nested_key():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    title = copy.get("qa.service_unavailable_title")
    assert title == "自动识图暂时不可用"


def test_product_visual_copy_get_with_slots():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    hint = copy.get("shot_confirm.hint", n="3")
    assert "3" in hint


def test_map_qa_failure_returns_dict():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    result = copy.map_qa_failure(reason="format_error", vision_used=False, metrics={})
    assert isinstance(result, dict)
    assert result["kind"] == "callout_info"
    assert "title" in result
    assert "body" in result
    assert "options" in result
    assert result["options"][0]["label"] == "就用这张图，继续"


def test_build_context_recap_from_visual_intent():
    recap = build_context_recap(
        {
            "visual_intent": {"primary_goal": "巨峰葡萄礼盒主视觉"},
            "route_context": {"utterance": "其他内容"},
        }
    )
    assert "巨峰葡萄礼盒" in recap
    assert len(recap) <= 120


def test_interrupt_event_payload_includes_presentation():
    presentation = {"kind": "callout_info", "context_recap": "测试"}
    ev = interrupt_event_payload(
        next_nodes=["await_image_qa"],
        phase="await_image_qa",
        presentation=presentation,
    )
    assert ev["data"]["presentation"] == presentation


def test_shot_confirm_primary_action_label():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    env = build_presentation_envelope(
        kind="shot_table",
        phase="await_shot_confirm",
        state={
            "visual_intent": {"primary_goal": "巨峰葡萄礼盒"},
            "shot_manifest": [{"shot_id": "a"}, {"shot_id": "b"}, {"shot_id": "c"}],
        },
        copy=copy,
    )
    assert env["primary_action"]["label"] == "确认构图，生成预览"
    assert env["primary_action"]["message"] == "确认出图"
    assert "3" in env["body"]["text"]


def test_topo_primary_action_label_distinct_from_shot():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    shot_env = build_presentation_envelope(
        kind="shot_table",
        phase="await_shot_confirm",
        state={"shot_manifest": [{"shot_id": "a"}]},
        copy=copy,
    )
    topo_env = build_presentation_envelope(
        kind="topo_card_list",
        phase="await_topo",
        state={
            "split_manifest": [
                {"key": "hero__1", "role": "downstream"},
                {"key": "scene__1", "role": "downstream"},
            ],
        },
        copy=copy,
    )
    assert shot_env["primary_action"]["label"] == "确认构图，生成预览"
    assert topo_env["primary_action"]["label"] != shot_env["primary_action"]["label"]
    assert "分钟" in topo_env["primary_action"]["label"]
    assert "2" in topo_env["body"]["text"]


def test_macro_select_envelope_includes_ab_expectation():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    state = {
        "macro_schemes": [{"id": "A"}, {"id": "B"}],
        "selected_macro_scheme_ids": ["A", "B"],
        "shot_manifest": [
            {"shot_id": "packaging_hero__1", "macro_scheme_id": "A"},
            {"shot_id": "unboxing__1", "macro_scheme_id": "B"},
            {"shot_id": "gift_scene__1", "macro_scheme_id": "A"},
        ],
        "visual_intent": {"primary_goal": "礼盒"},
        "route_context": {},
    }
    env = build_presentation_envelope(
        kind="macro_scheme_cards",
        phase="await_macro_scheme_select",
        state=state,
        copy=copy,
    )
    footer = env["body"]["footer_hint"]
    assert "2 套" in footer or "两套" in footer
    assert env["body"]["expected_delivery_count"] >= 1


def test_compute_expected_delivery_mixed_mode():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    delivery = compute_expected_delivery(
        ["A", "B"],
        [
            {"shot_id": "packaging_hero__1"},
            {"shot_id": "unboxing__1"},
            {"shot_id": "gift_scene__1"},
        ],
        copy=copy,
    )
    assert delivery["total_finalize"] == 3
    assert delivery["scene_count"] == 3
    assert "2 套" in delivery["allocation_note"] or "两套" in delivery["allocation_note"]
