"""product_visual routing — unit + eval-route-set gold runner."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.nodes.intake import make_intake_node
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route
from app.skills.loader import discover_skills

SKILLS = Path(__file__).resolve().parents[1] / "skills"
EVAL_PATH = SKILLS / "ecommerce-product-visual" / "eval-route-set.yaml"
VALID_SKILLS = {"ecommerce-product-visual", "enterprise-marketing-campaign"}


@pytest.fixture(scope="module")
def route_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def _state_from_fixture(raw: dict) -> dict:
    state = dict(raw)
    msgs = state.pop("messages", [])
    parsed = []
    for message in msgs:
        if isinstance(message, dict) and message.get("role") in ("user", "human"):
            parsed.append(HumanMessage(content=str(message.get("content") or "")))
        elif isinstance(message, HumanMessage):
            parsed.append(message)
    state["messages"] = parsed
    return state


def test_ecommerce_product_visual_skill_discovered():
    ids = {skill.skill_id for skill in discover_skills(SKILLS)}
    assert "ecommerce-product-visual" in ids


def test_explicit_skill_routes_product_visual():
    ctx = {
        "utterance": "帮我出主图和场景图",
        "requested_skill_id": "ecommerce-product-visual",
        "has_product_photo_attachment": True,
        "sidebar_attachments": [{"kind": "image", "role": "product"}],
    }
    decision = decide_route(ctx, valid_skill_ids={"ecommerce-product-visual"})
    assert decision["flow_mode"] == "product_visual"
    assert decision["reason"] == "explicit_product_visual_skill"


def test_single_image_atomic_not_product_visual():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": "把背景换成白色"}],
            "sidebar_attachments": [{"kind": "image", "role": "product"}],
        }
    )
    decision = decide_route(ctx)
    assert decision["flow_mode"] != "product_visual"


@pytest.mark.asyncio
async def test_intake_keeps_skill_id_for_product_visual():
    node = make_intake_node(SKILLS)
    out = await node(
        {
            "messages": [HumanMessage(content="帮我出主图和场景图")],
            "requested_skill_id": "ecommerce-product-visual",
            "sidebar_attachments": [{"kind": "image", "role": "product"}],
        }
    )
    assert out["flow_mode"] == "product_visual"
    assert out["skill_id"] == "ecommerce-product-visual"
    assert "主图" in (out.get("user_brief") or "")


def test_eval_product_visual_route_set_minimum_cases(route_cases: list[dict]):
    assert len(route_cases) >= 8, f"eval-route-set needs ≥8 cases, got {len(route_cases)}"


def test_eval_product_visual_route_set_gold(route_cases: list[dict]):
    mismatches: list[str] = []
    for case in route_cases:
        case_id = case["id"]
        state = _state_from_fixture(case.get("state") or {})
        gold = case.get("gold") or {}
        ctx = assemble_route_context(state)
        decision = decide_route(ctx, valid_skill_ids=VALID_SKILLS)
        if gold.get("flow_mode") and decision.get("flow_mode") != gold["flow_mode"]:
            mismatches.append(
                f"{case_id}: flow_mode {decision.get('flow_mode')} != {gold['flow_mode']}"
            )
        if gold.get("reason") and decision.get("reason") != gold["reason"]:
            mismatches.append(
                f"{case_id}: reason {decision.get('reason')} != {gold['reason']}"
            )
    assert not mismatches, "\n".join(mismatches)
