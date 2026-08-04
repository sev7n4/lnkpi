"""Phase 1: production bug regression cases (checkpoint + multi parse)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.atomic_intent import atomic_create_intent, atomic_regenerate_intent
from app.graph.atomic_parse_util import parse_atomic_multi_items
from app.graph.nodes.intake import make_intake_node

REGRESSION_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-intent-regression.yaml"
)
SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


@pytest.fixture(scope="module")
def regression_cases() -> list[dict]:
    doc = yaml.safe_load(REGRESSION_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case_id",
    ["reg-01", "reg-02", "reg-03"],
)
async def test_intake_regression_with_checkpoint(regression_cases: list[dict], case_id: str):
    case = next(c for c in regression_cases if c["id"] == case_id)
    intake = make_intake_node(SKILLS_DIR)
    ckpt = case.get("checkpoint") or {}
    state = {
        "messages": [HumanMessage(content=case["utterance"])],
        **ckpt,
    }
    out = await intake(state)
    assert out["flow_mode"] == case["gold"]["flow_mode"], case_id


@pytest.mark.asyncio
@pytest.mark.parametrize("case_id", ["reg-neg-01", "reg-neg-02"])
async def test_intake_no_regenerate_without_checkpoint(regression_cases: list[dict], case_id: str):
    case = next(c for c in regression_cases if c["id"] == case_id)
    intake = make_intake_node(SKILLS_DIR)
    out = await intake({"messages": [HumanMessage(content=case["utterance"])]})
    assert out.get("flow_mode") != "atomic_regenerate", case_id


@pytest.mark.parametrize("case_id", ["trap-01", "trap-02", "trap-03"])
def test_intent_classifier_regression(regression_cases: list[dict], case_id: str):
    case = next(c for c in regression_cases if c["id"] == case_id)
    gold = case["gold"]
    utterance = case["utterance"]
    if "atomic_create_intent" in gold:
        assert atomic_create_intent(utterance) is gold["atomic_create_intent"], case_id
    if "atomic_regenerate_intent" in gold:
        assert atomic_regenerate_intent(utterance) is gold["atomic_regenerate_intent"], case_id


@pytest.mark.parametrize("case_id", ["multi-01", "multi-02"])
def test_multi_parse_regression(regression_cases: list[dict], case_id: str):
    case = next(c for c in regression_cases if c["id"] == case_id)
    items = parse_atomic_multi_items(case["utterance"])
    gold = case["gold"]
    assert items is not None, case_id
    assert len(items) == gold["multi_item_count"], case_id
    assert [i["prompt"] for i in items] == gold["item_prompts"], case_id


def test_multi_parse_negative(regression_cases: list[dict]):
    case = next(c for c in regression_cases if c["id"] == "multi-neg-01")
    assert parse_atomic_multi_items(case["utterance"]) is None
