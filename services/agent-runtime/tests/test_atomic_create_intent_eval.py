"""P4-01: eval-intent-set.yaml schema validation + gold coverage."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

EVAL_PATH = Path(__file__).resolve().parents[1] / "skills" / "atomic-create" / "eval-intent-set.yaml"
TAXONOMY_PATH = Path(__file__).resolve().parents[1] / "skills" / "atomic-create" / "intent-taxonomy.yaml"

VALID_ROUTES = frozenset({"atomic_create", "single_node", "campaign", "chat"})
VALID_TARGET_TYPES = frozenset({"image", "text", "video", "audio", "prompt"})


@pytest.fixture(scope="module")
def eval_doc() -> dict:
    return yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def taxonomy_doc() -> dict:
    return yaml.safe_load(TAXONOMY_PATH.read_text(encoding="utf-8"))


def test_eval_set_has_80_cases(eval_doc: dict):
    cases = eval_doc.get("cases") or []
    assert len(cases) == 80
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids)), "duplicate case ids"


def test_eval_gold_schema(eval_doc: dict):
    for case in eval_doc["cases"]:
        assert "utterance" in case and case["utterance"].strip()
        gold = case["gold"]
        assert gold["route"] in VALID_ROUTES
        if gold["route"] == "atomic_create":
            assert gold["target_type"] in VALID_TARGET_TYPES
            tt = gold["target_type"]
            expect_confirm = tt in ("video", "audio")
            assert gold["confirm_gate"] is expect_confirm, f"{case['id']} confirm_gate mismatch"
        else:
            assert gold.get("target_type") is None or gold["route"] == "single_node"


def test_d1_storyboard_cases_are_text(eval_doc: dict):
    storyboard_ids = {"txt-01", "txt-06"}
    for case in eval_doc["cases"]:
        if case["id"] in storyboard_ids:
            assert case["gold"]["target_type"] == "text", case["id"]


def test_d2_video_audio_all_require_confirm(eval_doc: dict):
    for case in eval_doc["cases"]:
        tt = case["gold"].get("target_type")
        if tt in ("video", "audio"):
            assert case["gold"]["confirm_gate"] is True, case["id"]


def test_taxonomy_confirm_flags_match_d2(taxonomy_doc: dict):
    types = taxonomy_doc["target_types"]
    assert types["video"]["confirm_gate"] is True
    assert types["audio"]["confirm_gate"] is True
    assert types["image"]["confirm_gate"] is False
    assert types["text"]["confirm_gate"] is False


def test_taxonomy_has_regenerate_priority(taxonomy_doc: dict):
    priority = taxonomy_doc.get("intake_priority") or []
    ids = [p.get("id") for p in priority]
    assert "atomic_regenerate" in ids
    assert ids.index("atomic_regenerate") < ids.index("atomic_create")


def test_modality_coverage(eval_doc: dict):
    atomic = [c for c in eval_doc["cases"] if c["gold"]["route"] == "atomic_create"]
    by_type = {t: 0 for t in VALID_TARGET_TYPES}
    for c in atomic:
        by_type[c["gold"]["target_type"]] += 1
    for t in VALID_TARGET_TYPES:
        assert by_type[t] >= 1, f"missing atomic_create case for {t}"
