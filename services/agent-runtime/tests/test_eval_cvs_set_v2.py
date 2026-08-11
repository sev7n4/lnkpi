"""eval-cvs-set-v2.yaml dry-run runner (spec §8)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.graph.nodes.canvas_ssot_commit import build_ssot_content_from_state
from app.graph.nodes.decompose_from_ssot import make_decompose_from_ssot_node
from app.graph.nodes.dialog_draft import make_dialog_draft_node
from app.graph.nodes.macro_scheme_select_gate import apply_macro_scheme_decision
from app.graph.product_visual_v2.limits import MAX_DOWNSTREAM
from app.graph.product_visual_v2.manifest import build_gen_items_from_shots

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "ecommerce-product-visual"
    / "eval-cvs-set-v2.yaml"
)
SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


class FakeLLM:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    async def ainvoke(self, messages: Any) -> Any:
        class R:
            content = json.dumps(self.payload, ensure_ascii=False)

        return R()


class FakeNest:
    async def upsert(self, **kwargs: Any) -> dict[str, str]:
        return {"nodeId": "shot-node"}

    async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, str]:
        return {"nodeId": "ssot-1"}


def _shot_type_ids(shots: list[dict]) -> set[str]:
    return {str(s.get("type_id") or "") for s in shots if isinstance(s, dict)}


def _expand_v2_cases(raw_cases: list[dict]) -> list[dict]:
    by_id = {c["id"]: c for c in raw_cases}
    expanded: list[dict] = []
    for case in raw_cases:
        parent_id = case.get("parent_id")
        if parent_id and parent_id in by_id:
            merged = {**by_id[parent_id], **case}
            merged["id"] = case["id"]
            expanded.append(merged)
        else:
            expanded.append(case)
    return expanded


@pytest.mark.parametrize(
    "case",
    _expand_v2_cases(yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))["cases"]),
    ids=lambda c: c["id"],
)
@pytest.mark.asyncio
async def test_eval_cvs_v2_dry_run(case: dict) -> None:
    dialog = case["dialog_fixture"]
    decompose = case["decompose_fixture"]

    skill_dir = SKILLS_DIR / "ecommerce-product-visual"
    assert skill_dir.is_dir()

    draft_node = make_dialog_draft_node(llm=FakeLLM(dialog), skills_dir=SKILLS_DIR)
    draft_out = await draft_node(
        {
            "messages": [],
            "product_visual_scheme_v2": True,
            "image_qa_result": "pass",
        }
    )
    prose = str(draft_out.get("macro_scheme_draft") or dialog["draft_prose"])
    min_chars = int(case.get("assert_prose_min_chars") or 0)
    if min_chars:
        assert len(prose) >= min_chars, f"{case['id']}: prose too short ({len(prose)})"

    schemes = draft_out.get("macro_schemes") or dialog["macro_schemes"]
    assert len(schemes) >= int(case.get("assert_macro_schemes_min") or 1)

    selected = case.get("assert_selected_macros")
    if selected:
        applied = apply_macro_scheme_decision(
            {"macro_schemes": schemes, "scheme_revision_count": 0},
            {"action": "confirm", "selected_ids": selected},
        )
        schemes = applied.get("macro_schemes") or schemes
        selected_ids = applied.get("selected_macro_scheme_ids") or selected
    else:
        selected_ids = [schemes[0]["id"]]

    ssot = build_ssot_content_from_state(
        {
            "macro_scheme_draft": prose,
            "macro_schemes": schemes,
            "selected_macro_scheme_ids": selected_ids,
        }
    )
    assert ssot.strip()
    assert not ssot.strip().startswith('{"image_types"')

    decompose_node = make_decompose_from_ssot_node(
        llm=FakeLLM({"shots": decompose["shots"]}),
        skills_dir=SKILLS_DIR,
        nest=FakeNest(),
    )
    decomp_out = await decompose_node(
        {
            "macro_scheme_draft": prose,
            "macro_schemes": schemes,
            "selected_macro_scheme_ids": selected_ids,
            "visual_intent": dialog.get("visual_intent") or {},
            "plan_node_id": "ssot-1",
            "product_visual_scheme_v2": True,
        }
    )
    shots = decomp_out.get("shot_manifest") or decompose["shots"]
    type_ids = _shot_type_ids(shots)
    for required in case.get("assert_shot_types_include") or []:
        assert required in type_ids, f"{case['id']}: missing shot type {required!r}, got {sorted(type_ids)}"
    for forbidden in case.get("assert_shot_types_exclude") or []:
        assert forbidden not in type_ids, f"{case['id']}: forbidden type {forbidden!r} present"

    if case.get("assert_macro_scheme_ids_on_shots"):
        macro_ids = {str(s.get("macro_scheme_id") or "") for s in shots}
        for mid in case["assert_macro_scheme_ids_on_shots"]:
            assert mid in macro_ids

    max_down = case.get("assert_max_downstream")
    if max_down is not None:
        items = build_gen_items_from_shots(shots, visual_intent=dialog.get("visual_intent"))
        assert len(items) <= max_down
        assert len(items) <= MAX_DOWNSTREAM
