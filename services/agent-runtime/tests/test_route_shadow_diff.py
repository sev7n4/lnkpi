"""T15: legacy vs unified route shadow diff on eval-route-set (≥99% parity)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route_legacy, decide_route_unified

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-route-set.yaml"
)
VALID_SKILLS = {"enterprise-marketing-campaign"}
MIN_AGREEMENT = 0.99


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


def test_route_shadow_eval_route_set(route_cases: list[dict]):
    total = len(route_cases)
    mismatches: list[str] = []
    for case in route_cases:
        case_id = case["id"]
        state = _state_from_fixture(case.get("state") or {})
        ctx = assemble_route_context(state)
        legacy = decide_route_legacy(ctx, valid_skill_ids=VALID_SKILLS)
        unified = decide_route_unified(ctx, valid_skill_ids=VALID_SKILLS)
        if legacy.get("flow_mode") != unified.get("flow_mode") or legacy.get("reason") != unified.get(
            "reason"
        ):
            mismatches.append(
                f"{case_id}: legacy={legacy.get('flow_mode')}/{legacy.get('reason')} "
                f"unified={unified.get('flow_mode')}/{unified.get('reason')} "
                f"rule={unified.get('precedence_rule_id')}"
            )
    agreement = (total - len(mismatches)) / total if total else 1.0
    assert agreement >= MIN_AGREEMENT, "\n".join(mismatches)
