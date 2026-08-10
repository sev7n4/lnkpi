"""product_visual Phase 4 delivery summary tests (Task 7)."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.delivery_summary import (
    apply_delivery_decision,
    build_delivery_selections,
    classify_delivery_decision,
    make_await_delivery_confirm_node,
    make_delivery_summary_node,
    route_after_collect_gen,
    validate_delivery_confirm,
)


def test_delivery_defaults_to_recommended():
    plan = {
        "image_types": [
            {
                "type_id": "hero_main",
                "schemes": [
                    {"scheme_id": "c1", "recommended": False},
                    {"scheme_id": "c2", "recommended": True},
                ],
                "selected_scheme_ids": ["c1", "c2"],
            }
        ]
    }
    gen_by_key = {"hero_main__c1": {"url": "u1"}, "hero_main__c2": {"url": "u2"}}
    sel = build_delivery_selections(plan, gen_by_key)
    assert sel["hero_main"] == "c2"


def test_route_after_collect_gen_product_visual():
    assert route_after_collect_gen({"flow_mode": "product_visual"}) == "delivery_summary"
    assert route_after_collect_gen({"flow_mode": "campaign"}) == "done"


@pytest.mark.asyncio
async def test_delivery_summary_sets_await_delivery_confirm():
    node = make_delivery_summary_node()
    out = await node(
        {
            "product_visual_plan": {
                "image_types": [
                    {
                        "type_id": "hero_main",
                        "schemes": [{"scheme_id": "c1", "recommended": True}],
                        "selected_scheme_ids": ["c1"],
                    }
                ]
            },
            "gen_by_key": {"hero_main__c1": {"node_id": "n1"}},
        }
    )
    assert out["phase"] == "await_delivery_confirm"
    assert out["delivery_selections"] == {"hero_main": "c1"}


def test_classify_delivery_confirm_message():
    assert classify_delivery_decision("确认全部定稿")["action"] == "confirm_delivery"


@pytest.mark.asyncio
async def test_await_delivery_confirm_routes_done():
    node = make_await_delivery_confirm_node()
    state = {
        "product_visual_plan": {
            "image_types": [
                {
                    "type_id": "hero_main",
                    "schemes": [{"scheme_id": "c1", "recommended": True}],
                    "selected_scheme_ids": ["c1"],
                }
            ]
        },
        "gen_by_key": {"hero_main__c1": {"node_id": "n1", "url": "https://cdn/x.png"}},
        "delivery_selections": {"hero_main": "c1"},
        "messages": [AIMessage(content="summary"), HumanMessage(content="确认全部定稿")],
    }
    out = await node(state)
    assert out["phase"] == "done"
    assert out["delivery_selections"] == {"hero_main": "c1"}


def test_confirm_rejects_incomplete_delivery():
    plan = {
        "image_types": [
            {"type_id": "hero_main", "schemes": [{"scheme_id": "c1"}]},
            {"type_id": "scene", "schemes": [{"scheme_id": "c1"}]},
        ]
    }
    gen_by_key = {"hero_main__c1": {"url": "https://cdn/a.png"}}
    ok, err = validate_delivery_confirm(
        plan,
        {"hero_main": "c1", "scene": "c1"},
        gen_by_key,
    )
    assert not ok
    assert "scene" in err

    out = apply_delivery_decision(
        {
            "product_visual_plan": plan,
            "gen_by_key": gen_by_key,
            "delivery_selections": {"hero_main": "c1", "scene": "c1"},
            "messages": [],
        },
        {"action": "confirm_delivery"},
    )
    assert out["phase"] == "await_delivery_confirm"
    assert "无法确认" in out["messages"][0].content


def test_confirm_accepts_complete_delivery():
    plan = {
        "image_types": [
            {"type_id": "hero_main", "schemes": [{"scheme_id": "c1"}]},
            {"type_id": "scene", "schemes": [{"scheme_id": "c1"}]},
        ]
    }
    gen_by_key = {
        "hero_main__c1": {"url": "https://cdn/a.png"},
        "scene__c1": {"url": "https://cdn/b.png"},
    }
    out = apply_delivery_decision(
        {
            "product_visual_plan": plan,
            "gen_by_key": gen_by_key,
            "delivery_selections": {"hero_main": "c1", "scene": "c1"},
            "messages": [],
        },
        {"action": "confirm_delivery"},
    )
    assert out["phase"] == "done"


def test_apply_delivery_decision_refine_type():
    state = {
        "product_visual_plan": {"image_types": []},
        "delivery_selections": {"hero_main": "c2"},
        "split_manifest": [
            {"key": "hero_main__c2", "title": "主图", "node_id": "n2", "prompt_hint": "base"}
        ],
        "gen_by_key": {"hero_main__c2": {"node_id": "n2"}},
        "messages": [],
    }
    out = apply_delivery_decision(
        state,
        {"action": "refine_type", "type_id": "hero_main", "feedback": "背景更亮"},
    )
    assert out["phase"] == "orchestrate_gen"
    assert out["gen_ordered_keys"] == ["hero_main__c2"]
    refined = next(it for it in out["split_manifest"] if it["key"] == "hero_main__c2")
    assert "背景更亮" in refined["prompt_hint"]
