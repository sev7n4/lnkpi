"""Phase 3: variant regenerate → new node; same-node retry unchanged."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.atomic_intent import (
    atomic_regenerate_intent,
    detect_regenerate_adjust,
    is_regenerate_new_variant,
)
from app.graph.builder import route_after_intake
from app.graph.nodes.atomic_create_node import make_create_atomic_node
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node


def test_variant_phrases_are_not_same_node_regenerate():
    assert is_regenerate_new_variant("重新生成一张，背景改成白色")
    assert is_regenerate_new_variant("按刚才那个风格再生成一张")
    assert not is_regenerate_new_variant("重新生成一张")
    assert not is_regenerate_new_variant("再试一次")
    assert not atomic_regenerate_intent("重新生成一张，背景改成白色")
    assert atomic_regenerate_intent("重新生成一张")


def test_detect_regenerate_adjust_with_tail():
    assert detect_regenerate_adjust("重新生成一张，背景改成白色") == "背景改成白色"
    assert detect_regenerate_adjust("按刚才那个风格再生成一张") == "按刚才那个风格"


def test_route_after_intake_pure_regenerate_only():
    assert route_after_intake({"flow_mode": "atomic_regenerate", "messages": []}) == "prepare_atomic_regenerate"


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    async def get_canvas_summary(self) -> dict:
        return {
            "nodes": [
                {"id": "node-abc", "type": "image", "title": "模特图"},
            ]
        }

    async def add_nodes_batch(self, batch: list[dict]) -> dict:
        self.calls.append(("add_nodes_batch", batch))
        return {
            "nodes": [
                {"key": batch[0]["key"], "nodeId": "node-new-1"},
            ]
        }

    async def run_image_generation(self, node_id: str) -> dict:
        self.calls.append(("run_image_generation", node_id))
        return {"status": "completed", "generationRecordId": "rec-new-1"}


@pytest.mark.asyncio
async def test_intake_variant_routes_to_atomic_create(tmp_path: Path):
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
        assert out["flow_mode"] == "atomic_create", utterance


@pytest.mark.asyncio
async def test_variant_create_adds_new_node_not_regenerate_old():
    nest = FakeNest()
    prior = {
        "target_type": "image",
        "title": "模特图",
        "prompt": "模特人物图",
        "confirm_gate": False,
    }
    parse = make_parse_atomic_intent_node(nest=nest, llm=None)
    parsed = await parse(
        {
            "messages": [HumanMessage(content="重新生成一张，背景改成白色")],
            "atomic_node_id": "node-abc",
            "atomic_spec": prior,
        }
    )
    assert "背景改成白色" in parsed["atomic_spec"]["prompt"]
    assert parsed["atomic_spec"]["title"] == "模特图 (2)"

    create = make_create_atomic_node(nest=nest)
    created = await create(parsed)
    assert created["atomic_node_id"] == "node-new-1"
    assert any(c[0] == "add_nodes_batch" for c in nest.calls)

    run = make_run_atomic_gen_node(nest=nest)
    done = await run({**created, **parsed})
    assert done["phase"] == "done"
    assert ("run_image_generation", "node-new-1") in nest.calls
    assert not any(c == ("run_image_generation", "node-abc") for c in nest.calls)


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
