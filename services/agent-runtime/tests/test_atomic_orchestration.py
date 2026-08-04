"""Phase 4: orchestration complexity and multi-limit tests."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.atomic_intent import (
    orchestration_complexity_intent,
    resolve_intake_route,
)
from app.graph.atomic_parse_schema import MAX_ATOMIC_MULTI_ITEMS, validate_parse_result
from app.graph.nodes.intake import make_intake_node
from app.graph.subgraphs.atomic_create_gate import route_after_atomic_create

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-orchestration-set.yaml"
)


@pytest.fixture(scope="module")
def orch_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def test_eval_orchestration_complexity(orch_cases: list[dict]):
    mismatches: list[str] = []
    for case in orch_cases:
        utterance = case["utterance"]
        gold = case["gold"]
        pred_orch = orchestration_complexity_intent(utterance)
        if pred_orch != gold["complexity"]:
            mismatches.append(f"{case['id']}: complexity {pred_orch} != {gold['complexity']}")
    assert not mismatches, "\n".join(mismatches)


def test_multi_item_limit_clarify():
    items = [
        {"target_type": "image", "title": f"图{i}", "prompt": f"图{i}", "confirm_gate": False}
        for i in range(MAX_ATOMIC_MULTI_ITEMS + 1)
    ]
    outcome = validate_parse_result(
        {"structure": "multi", "items": items, "confidence": 0.95, "reason": "test"},
        utterance="六张图",
    )
    assert outcome["kind"] == "clarify"
    assert outcome["reason"] == "multi_item_limit"


def test_mixed_modal_routes_to_confirm():
    assert (
        route_after_atomic_create(
            {
                "phase": "atomic_create",
                "atomic_spec": {"target_type": "image", "confirm_gate": False},
                "atomic_items": [
                    {"target_type": "image", "title": "主图"},
                    {"target_type": "video", "title": "视频", "confirm_gate": True},
                ],
            }
        )
        == "await_atomic_confirm"
    )


@pytest.mark.asyncio
async def test_intake_storyboard_redirects_to_campaign(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({"messages": [HumanMessage(content="帮我生成12个分镜镜头")]})
    assert out["flow_mode"] == "campaign"
    assert out.get("skill_id") is not None
