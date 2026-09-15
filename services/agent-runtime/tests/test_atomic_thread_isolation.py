"""Phase 3: variant regenerate soft-intent + intake routing (subgraph path retired)."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.atomic_intent import (
    regen_intent,
    detect_regenerate_adjust,
    is_regenerate_new_variant,
)
from app.graph.builder import route_after_intake
from app.graph.nodes.intake import make_intake_node


def test_variant_phrases_are_not_same_node_regenerate():
    assert is_regenerate_new_variant("重新生成一张，背景改成白色")
    assert is_regenerate_new_variant("按刚才那个风格再生成一张")
    assert not is_regenerate_new_variant("重新生成一张")
    assert not is_regenerate_new_variant("再试一次")
    assert not regen_intent("重新生成一张，背景改成白色")
    assert regen_intent("重新生成一张")


def test_detect_regenerate_adjust_with_tail():
    assert detect_regenerate_adjust("重新生成一张，背景改成白色") == "背景改成白色"
    assert detect_regenerate_adjust("按刚才那个风格再生成一张") == "按刚才那个风格"


def test_route_after_intake_legacy_atomic_regenerate_goes_explore():
    assert route_after_intake({"flow_mode": "atomic_regenerate", "messages": []}) == "explore"


@pytest.mark.asyncio
async def test_intake_variant_routes_to_canvas_agent(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    checkpoint = {
        "atomic_node_id": "node-abc",
        "atomic_spec": {
            "target_type": "image",
            "title": "模特图",
            "prompt": "模特人物图",
            "confirm_gate": False,
        },
    }
    for utterance in ("重新生成一张，背景改成白色", "按刚才那个风格再生成一张"):
        out = await intake({**checkpoint, "messages": [HumanMessage(content=utterance)]})
        assert out["flow_mode"] == "canvas_agent", utterance


@pytest.mark.asyncio
async def test_intake_atomic_clears_campaign_split_manifest(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake(
        {
            "messages": [HumanMessage(content="帮我生成一个模特人物图")],
            "plan_draft": "14 节点营销方案",
            "split_manifest": [{"key": "hero", "title": "主图", "target_type": "image"}],
            "user_brief": "天猫蓝牙耳机详情页",
        }
    )
    assert out["flow_mode"] == "canvas_agent"
    assert out["split_manifest"] == []
    assert out.get("skill_id") is None


@pytest.mark.asyncio
async def test_intake_regenerate_on_mixed_canvas_routes_canvas_agent(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake(
        {
            "messages": [HumanMessage(content="重新生成一张")],
            "atomic_node_id": "node-abc",
            "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特人物图"},
            "plan_draft": "campaign plan",
            "split_manifest": [{"key": "hero", "title": "主图"}],
        }
    )
    assert out["flow_mode"] == "canvas_agent"
    # checkpoint_regen no longer clears campaign residue the way atomic_regenerate did;
    # only utterance_suggests_media_create clears split_manifest.
    assert out.get("skill_id") is None
    assert (out.get("route_decision") or {}).get("precedence_rule_id") == "checkpoint_regen"
