"""eval-route-set.yaml gold runner."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-route-set.yaml"
)
VALID_SKILLS = {"enterprise-marketing-campaign"}


@pytest.fixture(scope="module")
def route_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def _state_from_fixture(raw: dict) -> dict:
    state = dict(raw)
    msgs = state.pop("messages", [])
    parsed = []
    for m in msgs:
        if isinstance(m, dict) and m.get("role") in ("user", "human"):
            parsed.append(HumanMessage(content=str(m.get("content") or "")))
        elif isinstance(m, HumanMessage):
            parsed.append(m)
    state["messages"] = parsed
    return state


def test_eval_route_set_gold(route_cases: list[dict]):
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
        if "is_modify" in gold and decision.get("is_modify") != gold["is_modify"]:
            mismatches.append(
                f"{case_id}: is_modify {decision.get('is_modify')} != {gold['is_modify']}"
            )
    assert not mismatches, "\n".join(mismatches)
