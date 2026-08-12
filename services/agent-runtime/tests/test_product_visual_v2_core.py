"""L1 tests for product_visual_v2 (spec test-cases P0)."""

from __future__ import annotations

import json

import pytest

from app.graph.product_visual_v2.limits import (
    MAX_DOWNSTREAM,
    count_downstream,
    is_valid_shot_id,
    validate_downstream_limit,
)
from app.graph.product_visual_v2.macro_select import (
    apply_macro_selection,
    default_macro_selection,
    should_skip_macro_hitl,
    validate_macro_selection,
)
from app.graph.product_visual_v2.models import DialogDraftOutput, MacroScheme, ShotManifestItem
from app.graph.product_visual_v2.routing import (
    route_after_dialog_draft,
    route_after_image_qa_check_v2,
    route_after_macro_scheme_select,
)
from app.graph.product_visual_v2.ssot import build_ssot_prose, is_prose_content, ssot_section_keys
from app.graph.product_visual_v2.synthesize import synthesize_gen_prompt_hint
from app.graph.product_visual_v2.vision_qa import VisionQAResult, evaluate_vision_qa_v2


def test_shot_id_format_p3_dec_004():
    assert is_valid_shot_id("packaging_hero__1")
    assert is_valid_shot_id("model_holding_pack__2")
    assert not is_valid_shot_id("c1")
    assert not is_valid_shot_id("packaging_hero")


def test_downstream_limit_p3_dec_006():
    shots = [{"variant_count": 2}] * 6
    err = validate_downstream_limit(phase1_seed_count=2, shots=shots)
    assert err is not None
    assert str(MAX_DOWNSTREAM) in err


def test_count_downstream():
    assert count_downstream(phase1_seed_count=2, shots=[{"variant_count": 1}] * 3) == 5


def test_macro_ab_parallel_ssot_p2_macro_003():
    content = build_ssot_prose(
        sections={"A": "红金礼盒方案正文。", "B": "极简牛皮方案正文。"},
        merge_mode="parallel",
    )
    assert "## 方案 A" in content
    assert "## 方案 B" in content
    assert ssot_section_keys(content) == ["A", "B"]


def test_macro_selection_max_four_p2_macro_004():
    assert validate_macro_selection(["A", "B"]) is None
    assert validate_macro_selection(["A", "B", "C", "D"]) is None
    assert validate_macro_selection(["A", "B", "C", "D", "E"]) is not None


def test_apply_macro_selection():
    schemes = [
        MacroScheme(id="A", label="A", summary="s"),
        MacroScheme(id="B", label="B", summary="s"),
    ]
    out = apply_macro_selection(schemes, ["A"])
    assert out["selected_macro_scheme_ids"] == ["A"]
    assert out["phase"] == "canvas_ssot_commit"


def test_skip_macro_hitl_single():
    assert should_skip_macro_hitl([MacroScheme(id="A", label="only", summary="")])
    assert not should_skip_macro_hitl(
        [
            MacroScheme(id="A", label="A", summary=""),
            MacroScheme(id="B", label="B", summary=""),
        ]
    )


def test_default_macro_selection_recommended():
    schemes = [
        {"id": "A", "label": "A", "recommended": False},
        {"id": "B", "label": "B", "recommended": True},
    ]
    assert default_macro_selection(schemes) == ["B"]


def test_vision_qa_requires_vision_p1_vqa_001():
    out = evaluate_vision_qa_v2(VisionQAResult(pass_=True, reason="大闸蟹清晰", vision_used=True))
    assert out["image_qa_result"] == "pass"
    assert out.get("vision_used") is True


def test_vision_qa_heuristic_only_fails_p1_vqa_003():
    out = evaluate_vision_qa_v2(VisionQAResult(pass_=True, reason="x", vision_used=False))
    assert out["image_qa_result"] == "fail"


def test_route_after_qa_v2_lazy():
    assert route_after_image_qa_check_v2({"image_qa_result": "pass"}) == "dialog_draft"


def test_route_after_qa_v2_eager():
    assert (
        route_after_image_qa_check_v2(
            {"image_qa_result": "pass", "requires_standard_product_assets": True}
        )
        == "phase1_seed_eager"
    )


def test_route_after_dialog_draft_single():
    assert route_after_dialog_draft({"macro_schemes": [{"id": "A"}]}) == "canvas_ssot_commit"


def test_route_after_dialog_draft_multi():
    assert route_after_dialog_draft(
        {"macro_schemes": [{"id": "A"}, {"id": "B"}]}
    ) == "await_macro_scheme_select"


def test_synthesize_differs_from_shot_prose_p3_syn_001():
    shot = "模特在中秋场景手持礼盒，侧光，节日氛围。"
    hint = synthesize_gen_prompt_hint(
        shot_prose=shot,
        shot_label="模特手持礼盒",
        type_id="model_holding_pack",
        visual_intent={"style_hints": ["中秋红金"]},
    )
    assert hint
    assert hint.strip() != shot.strip()


def test_is_prose_content_rejects_json_plan():
    json_plan = json.dumps({"image_types": [{"type_id": "hero_main"}]}, ensure_ascii=False)
    assert not is_prose_content(json_plan, min_length=10)


def test_dialog_draft_output_rejects_json_only():
    with pytest.raises(ValueError):
        DialogDraftOutput.model_validate(
            {
                "draft_prose": json.dumps({"image_types": []}),
                "macro_schemes": [{"id": "A", "label": "A", "summary": "s"}],
            }
        )


def test_shot_manifest_item_validates():
    item = ShotManifestItem(
        shot_id="packaging_hero__1",
        type_id="packaging_hero",
        label="礼盒主视觉",
        macro_scheme_id="A",
    )
    assert item.shot_id == "packaging_hero__1"


def test_route_macro_revise():
    assert route_after_macro_scheme_select({"macro_scheme_decision": "revise"}) == "dialog_draft"
