#!/usr/bin/env python3
"""Phase 2: eval-intent-set routing report (rule-based resolve_intake_route)."""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
EVAL_PATH = ROOT / "skills" / "atomic-create" / "eval-intent-set.yaml"

sys.path.insert(0, str(ROOT))

from app.graph.atomic_intent import build_atomic_spec, resolve_intake_route  # noqa: E402


def main() -> int:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    cases = doc.get("cases") or []
    mismatches: list[str] = []
    confusion: dict[str, Counter[str]] = defaultdict(Counter)

    for case in cases:
        utterance = case["utterance"]
        gold = case["gold"]
        focus = case.get("focus_node_id")
        pred = resolve_intake_route(utterance, focus_node_id=focus)
        confusion[gold["route"]][pred] += 1
        if pred != gold["route"]:
            mismatches.append(f"{case['id']}: pred={pred} gold={gold['route']}")
            continue
        if gold["route"] == "atomic_create":
            spec = build_atomic_spec(utterance)
            if spec["target_type"] != gold["target_type"]:
                mismatches.append(
                    f"{case['id']}: target {spec['target_type']} != {gold['target_type']}"
                )

    total = len(cases)
    correct = total - len(mismatches)
    accuracy = correct / total if total else 0.0
    print(f"eval-intent-set: {correct}/{total} correct ({accuracy:.1%})")
    print("\nConfusion (gold -> pred counts):")
    for gold_route in sorted(confusion):
        parts = ", ".join(f"{p}:{n}" for p, n in sorted(confusion[gold_route].items()))
        print(f"  {gold_route}: {parts}")
    if mismatches:
        print("\nMismatches:")
        for line in mismatches:
            print(f"  - {line}")
    threshold = 0.95
    if accuracy < threshold:
        print(f"\nFAIL: accuracy {accuracy:.1%} < {threshold:.0%}")
        return 1
    print(f"\nPASS: accuracy >= {threshold:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
