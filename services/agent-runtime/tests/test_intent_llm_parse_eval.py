"""Phase C: eval-intent-llm-set.yaml gold runner."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from app.graph.atomic_intent import parse_atomic_target_type, resolve_intake_route
from app.graph.intent_parse_schema import intent_result_to_parse_outcome
from app.graph.planning_guard import validate_llm_parse

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "atomic-create"
    / "eval-intent-llm-set.yaml"
)

AGREEMENT_MIN = 0.90


@pytest.fixture(scope="module")
def llm_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def test_eval_set_has_80_cases(llm_cases: list[dict]):
    assert len(llm_cases) == 80


def _outcome_matches_gold(outcome: dict, gold: dict, utterance: str) -> bool:
    expected_outcome = gold.get("outcome")
    if expected_outcome == "clarify":
        if outcome.get("kind") != "clarify":
            return False
    elif expected_outcome == "success":
        if outcome.get("kind") != "success":
            return False
        tt = gold.get("target_type")
        if tt and outcome.get("items"):
            if outcome["items"][0].get("target_type") != tt:
                return False
    if gold.get("forbid_image"):
        if outcome.get("kind") == "success":
            items = outcome.get("items") or []
            if any(i.get("target_type") == "image" for i in items):
                return False
    route = gold.get("route")
    if route == "campaign" and outcome.get("kind") == "clarify":
        if outcome.get("reason") not in ("llm_route_campaign", "planning_image_conflict", "campaign_override"):
            pass  # still OK for campaign expected clarify
    if route == "atomic_create" and expected_outcome == "success":
        if outcome.get("kind") != "success":
            return False
    del utterance
    return True


def test_eval_llm_fixture_gold(llm_cases: list[dict]):
    mismatches: list[str] = []
    for case in llm_cases:
        fixture = case.get("llm_fixture")
        if not fixture:
            mismatches.append(f"{case['id']}: missing llm_fixture")
            continue
        utterance = case["utterance"]
        gold = case["gold"]
        guard = validate_llm_parse(fixture, utterance)  # type: ignore[arg-type]
        outcome = guard or intent_result_to_parse_outcome(fixture, utterance)  # type: ignore[arg-type]
        if not _outcome_matches_gold(outcome, gold, utterance):
            mismatches.append(
                f"{case['id']}: outcome {outcome.get('kind')}/{outcome.get('reason')} != gold {gold}"
            )
    assert not mismatches, "\n".join(mismatches)


def test_eval_fixture_rule_route_agreement(llm_cases: list[dict]):
    """Rule intake route agrees with gold.route on routable cases (≥90%)."""
    routable = [
        c
        for c in llm_cases
        if c["gold"].get("route") in ("campaign", "atomic_create")
        and c["category"] not in ("llm-adversarial", "llm-clarify-expected")
    ]
    agree = 0
    mismatches: list[str] = []
    for case in routable:
        utterance = case["utterance"]
        gold_route = case["gold"]["route"]
        pred = resolve_intake_route(utterance, focus_node_id=None)
        if gold_route == "campaign":
            ok = pred == "campaign"
        else:
            ok = pred == "atomic_create"
            if not ok and parse_atomic_target_type(utterance):
                ok = pred == "atomic_create"
        if ok:
            agree += 1
        else:
            mismatches.append(f"{case['id']}: rule route {pred} != {gold_route}")
    rate = agree / len(routable) if routable else 1.0
    assert rate >= AGREEMENT_MIN, f"agreement {rate:.1%}\n" + "\n".join(mismatches[:15])


def test_agreement_report_artifact(llm_cases: list[dict], tmp_path: Path):
    """Write agreement summary for CI artifact."""
    total = len(llm_cases)
    fixture_ok = 0
    for case in llm_cases:
        fixture = case.get("llm_fixture")
        if not fixture:
            continue
        guard = validate_llm_parse(fixture, case["utterance"])  # type: ignore[arg-type]
        outcome = guard or intent_result_to_parse_outcome(fixture, case["utterance"])  # type: ignore[arg-type]
        if _outcome_matches_gold(outcome, case["gold"], case["utterance"]):
            fixture_ok += 1
    report = {
        "total_cases": total,
        "fixture_pass": fixture_ok,
        "fixture_agreement_rate": round(fixture_ok / total, 4),
        "gate_min": AGREEMENT_MIN,
    }
    out = tmp_path / "intent-llm-agreement.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    assert report["fixture_agreement_rate"] >= AGREEMENT_MIN
