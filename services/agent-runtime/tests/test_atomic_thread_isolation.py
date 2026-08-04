"""Phase 3: adjust regenerate and thread isolation tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.atomic_intent import (
    apply_regenerate_adjust,
    detect_regenerate_adjust,
)
from app.graph.builder import route_after_intake
from app.graph.nodes.adjust_atomic_regenerate import make_adjust_atomic_regenerate_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node


def test_detect_regenerate_adjust_with_tail():
    assert detect_regenerate_adjust("重新生成一张，背景改成白色") == "背景改成白色"
    assert detect_regenerate_adjust("按刚才那个风格再生成一张") == "按刚才那个风格"


def test_detect_regenerate_adjust_pure_regenerate_none():
    assert detect_regenerate_adjust("重新生成一张") is None
    assert detect_regenerate_adjust("再试一次") is None


def test_apply_regenerate_adjust_merges_prompt():
    spec = {"target_type": "image", "prompt": "模特人物图", "title": "模特图"}
    out = apply_regenerate_adjust(spec, "背景改成白色")
    assert "模特人物图" in out["prompt"]
    assert "背景改成白色" in out["prompt"]


def test_apply_regenerate_adjust_style_from_context():
    spec = {"target_type": "image", "prompt": "模特人物图", "title": "模特图"}
    ctx = "近期对话:用户:赛博朋克耳机主图→助手:已创建"
    out = apply_regenerate_adjust(spec, "按刚才那个风格", parse_context=ctx)
    assert "赛博朋克耳机主图" in out["prompt"]


def test_route_after_intake_adjust_vs_prepare():
    assert route_after_intake({"flow_mode": "atomic_regenerate", "messages": []}) == "prepare_atomic_regenerate"
    assert (
        route_after_intake(
            {
                "flow_mode": "atomic_regenerate",
                "messages": [HumanMessage(content="重新生成一张，背景改成白色")],
            }
        )
        == "adjust_atomic_regenerate"
    )


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def get_node(self, node_id: str) -> dict:
        self.calls.append(("get_node", node_id))
        return {"id": node_id, "type": "image", "title": "模特图"}

    async def get_canvas_summary(self) -> dict:
        return {"nodes": []}

    async def run_image_generation(self, node_id: str) -> dict:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-adj-1"}


@pytest.mark.asyncio
async def test_adjust_regenerate_updates_prompt_before_gen():
    nest = FakeNest()
    spec = {"target_type": "image", "title": "模特图", "prompt": "模特人物图", "confirm_gate": False}
    adjust_node = make_adjust_atomic_regenerate_node(nest=nest)
    out = await adjust_node(
        {
            "atomic_node_id": "node-abc",
            "atomic_spec": spec,
            "messages": [HumanMessage(content="重新生成一张，背景改成白色")],
        }
    )
    assert "背景改成白色" in out["atomic_spec"]["prompt"]
    assert "按新要求" in out["messages"][0].content

    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**out, "atomic_node_id": "node-abc"})
    assert done["phase"] == "done"
    assert ("run_image_generation", "node-abc") in nest.calls


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
    assert out["flow_mode"] == "atomic_create"
    assert out["split_manifest"] == []
    assert out.get("skill_id") is None


@pytest.mark.asyncio
async def test_intake_regenerate_on_mixed_canvas(tmp_path: Path):
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
    assert out["flow_mode"] == "atomic_regenerate"
    assert out["split_manifest"] == []
