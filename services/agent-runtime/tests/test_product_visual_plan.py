"""product_visual Phase 2 plan parse + LLM node tests."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.plan_product_visual import (
    make_plan_product_visual_node,
    resolve_plan_phase,
)
from app.graph.product_visual_models import (
    parse_product_visual_plan,
    plan_all_types_single_scheme,
    prefill_selected_schemes,
)

CVS01_MINIMAL = """
{"visual_intent":{"primary_goal":"mixed_ecommerce","confidence":0.9},
 "image_types":[
   {"type_id":"hero_main","type_label":"主图","schemes":[{"scheme_id":"c1","recommended":true,"prompt":"..."}]},
   {"type_id":"model_display","type_label":"模特展示","schemes":[{"scheme_id":"c1","recommended":true,
     "key_elements":{"human_presence":true,"model_source":"generated"},"prompt":"..."}]}
 ]}
"""

MULTI_SCHEME_PLAN = """
{"visual_intent":{"primary_goal":"mixed","confidence":0.9},
 "image_types":[
   {"type_id":"hero_main","type_label":"主图","schemes":[{"scheme_id":"c1","recommended":true,"prompt":"a"}]},
   {"type_id":"packaging_hero","type_label":"包装","schemes":[
     {"scheme_id":"c1","recommended":false,"prompt":"b"},
     {"scheme_id":"c2","recommended":true,"prompt":"c"}
   ]}
 ]}
"""


def test_parse_cvs01_types():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    ids = {t.type_id for t in plan.image_types}
    assert "hero_main" in ids
    assert "model_display" in ids


def test_no_video_target_type_in_plan():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    for t in plan.image_types:
        assert getattr(t, "target_type", "image") == "image"


def test_parse_rejects_video_target_type():
    raw = """
    {"visual_intent":{"primary_goal":"mixed","confidence":0.5},
     "image_types":[{"type_id":"clip","type_label":"视频","target_type":"video",
       "schemes":[{"scheme_id":"c1","prompt":"x"}]}]}
    """
    with pytest.raises(ValueError):
        parse_product_visual_plan(raw)


def test_prefill_selected_schemes_single_variant():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    assert plan_all_types_single_scheme(plan)
    filled = prefill_selected_schemes(plan)
    for image_type in filled.image_types:
        assert image_type.selected_scheme_ids == [image_type.schemes[0].scheme_id]


def test_resolve_plan_phase_multi_scheme():
    plan = parse_product_visual_plan(MULTI_SCHEME_PLAN)
    assert resolve_plan_phase(plan.model_dump(mode="json")) == "await_scheme_select"


def test_resolve_plan_phase_all_single():
    plan = parse_product_visual_plan(CVS01_MINIMAL)
    assert resolve_plan_phase(plan.model_dump(mode="json")) == "split_product_visual"


class FakeLLM:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[Any] = []

    async def ainvoke(self, messages: Any) -> Any:
        self.calls.append(messages)

        class Resp:
            def __init__(self, text: str) -> None:
                self.content = text

        return Resp(self.content)


@pytest.mark.asyncio
async def test_plan_node_writes_product_visual_plan(tmp_path):
    from pathlib import Path

    skills_dir = Path(__file__).resolve().parents[1] / "skills"
    llm = FakeLLM(CVS01_MINIMAL)
    node = make_plan_product_visual_node(llm=llm, skills_dir=skills_dir)
    out = await node(
        {
            "messages": [HumanMessage(content="做保温杯主图和模特展示")],
            "user_brief": "保温杯电商推广图",
            "skill_id": "ecommerce-product-visual",
        }
    )
    assert out["phase"] == "split_product_visual"
    plan = out["product_visual_plan"]
    assert plan["visual_intent"]["primary_goal"] == "mixed_ecommerce"
    assert {t["type_id"] for t in plan["image_types"]} == {"hero_main", "model_display"}
    for image_type in plan["image_types"]:
        assert image_type["selected_scheme_ids"] == ["c1"]


@pytest.mark.asyncio
async def test_plan_node_routes_scheme_select_when_multi_variant(tmp_path):
    from pathlib import Path

    skills_dir = Path(__file__).resolve().parents[1] / "skills"
    llm = FakeLLM(MULTI_SCHEME_PLAN)
    node = make_plan_product_visual_node(llm=llm, skills_dir=skills_dir)
    out = await node(
        {
            "messages": [HumanMessage(content="主图和包装，包装要两版")],
            "user_brief": "混合电商+包装",
        }
    )
    assert out["phase"] == "await_scheme_select"
    packaging = next(t for t in out["product_visual_plan"]["image_types"] if t["type_id"] == "packaging_hero")
    assert packaging.get("selected_scheme_ids") in (None, [])


def test_revise_limit_forces_gen():
    from app.graph.nodes.scheme_select_gate import apply_scheme_decision

    state = {"scheme_revision_count": 3, "product_visual_plan": {"image_types": []}}
    out = apply_scheme_decision(state, decision={"action": "revise", "feedback": "加包装"})
    assert out["phase"] == "split_product_visual"
    assert "超限" in (out.get("assistant_note") or "")


def test_confirm_schemes_writes_selected_ids():
    from app.graph.nodes.scheme_select_gate import apply_scheme_decision

    plan = {
        "visual_intent": {"primary_goal": "mixed", "confidence": 0.9},
        "image_types": [
            {
                "type_id": "packaging_hero",
                "type_label": "包装",
                "schemes": [
                    {"scheme_id": "c1", "recommended": False, "prompt": "a"},
                    {"scheme_id": "c2", "recommended": True, "prompt": "b"},
                ],
            }
        ],
    }
    out = apply_scheme_decision(
        {"product_visual_plan": plan},
        decision={
            "action": "confirm_schemes",
            "selections": {"packaging_hero": ["c1", "c2"]},
        },
    )
    assert out["phase"] == "split_product_visual"
    selected = out["product_visual_plan"]["image_types"][0]["selected_scheme_ids"]
    assert selected == ["c1", "c2"]


def test_revise_under_limit_routes_plan():
    from app.graph.nodes.scheme_select_gate import apply_scheme_decision

    state = {
        "scheme_revision_count": 1,
        "product_visual_plan": {"image_types": [{"type_id": "hero_main", "schemes": [{}, {}]}]},
    }
    out = apply_scheme_decision(state, decision={"action": "revise", "feedback": "加包装"})
    assert out["phase"] == "plan_product_visual"
    assert out["scheme_revision_count"] == 2


def test_classify_scheme_decision_confirm_and_revise():
    from app.graph.nodes.scheme_select_gate import classify_scheme_decision

    assert classify_scheme_decision("确认所选变体")["action"] == "confirm_schemes"
    assert classify_scheme_decision("需要调整方案：加包装")["action"] == "revise"
    assert classify_scheme_decision("", user_decision="confirm")["action"] == "confirm_schemes"
