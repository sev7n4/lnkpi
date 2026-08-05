"""Planning Guard eval gold set."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from app.graph.atomic_intent import (
    build_atomic_spec,
    orchestration_complexity_intent,
    parse_atomic_target_type,
    resolve_intake_route,
)
from app.graph.atomic_parse_schema import validate_parse_result
from app.graph.atomic_parse_util import rule_parse_confidence

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-planning-guard-set.yaml"
)


@pytest.fixture(scope="module")
def planning_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def test_eval_planning_guard_gold(planning_cases: list[dict]):
    mismatches: list[str] = []
    for case in planning_cases:
        utterance = case["utterance"]
        gold = case["gold"]
        case_id = case["id"]

        if "route" in gold:
            route = resolve_intake_route(utterance, focus_node_id=None)
            if route != gold["route"]:
                mismatches.append(f"{case_id}: route {route} != {gold['route']}")

        if "complexity" in gold:
            orch = orchestration_complexity_intent(utterance)
            if orch != gold["complexity"]:
                mismatches.append(f"{case_id}: complexity {orch} != {gold['complexity']}")

        if gold.get("target_type"):
            pred = parse_atomic_target_type(utterance)
            if pred != gold["target_type"]:
                mismatches.append(f"{case_id}: target_type {pred} != {gold['target_type']}")

        if gold.get("forbid_target") == "image":
            pred = parse_atomic_target_type(utterance)
            if pred == "image":
                mismatches.append(f"{case_id}: forbidden target_type image")

        if gold.get("min_confidence"):
            spec = build_atomic_spec(utterance)
            conf = rule_parse_confidence(utterance, spec, None)
            if conf < gold["min_confidence"]:
                mismatches.append(f"{case_id}: confidence {conf} < {gold['min_confidence']}")

        if gold.get("validate_clarify"):
            out = validate_parse_result(
                {
                    "items": [
                        {
                            "target_type": "image",
                            "prompt": utterance,
                            "title": "x",
                        }
                    ],
                    "confidence": 0.96,
                },
                utterance=utterance,
            )
            if out["kind"] != "clarify":
                mismatches.append(f"{case_id}: expected clarify, got {out['kind']}")
            elif gold.get("reason") and out.get("reason") != gold["reason"]:
                mismatches.append(f"{case_id}: reason {out.get('reason')} != {gold['reason']}")

    assert not mismatches, "\n".join(mismatches)
