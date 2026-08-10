"""eval-cvs-set.yaml gold runner — route + plan dry-run (Task 8)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.nodes.image_qa_gate import derive_qa_metrics, evaluate_image_qa
from app.graph.nodes.plan_product_visual import make_plan_product_visual_node
from app.graph.nodes.split_product_visual import build_manifest_from_plan
from app.graph.product_visual_models import parse_product_visual_plan
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route

EVAL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "ecommerce-product-visual"
    / "eval-cvs-set.yaml"
)
SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"
VALID_SKILLS = {"ecommerce-product-visual", "enterprise-marketing-campaign"}

HUMAN_PRESENCE_TYPE_IDS = {
    "model_display",
    "model_holding_product",
    "model_holding_pack",
    "packaging_gift_scene",
    "space_with_people",
    "product_in_space",
}


@pytest.fixture(scope="module")
def cvs_doc() -> dict:
    return yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cvs_cases(cvs_doc: dict) -> list[dict]:
    return _expand_cases(cvs_doc["cases"])


def _expand_cases(raw_cases: list[dict]) -> list[dict]:
    expanded: list[dict] = []
    for parent in raw_cases:
        expanded.append(parent)
        for sub in parent.get("subcases") or []:
            merged = {**parent, **sub}
            merged["id"] = sub.get("id") or f"{parent['id']}:{sub.get('suffix', 'sub')}"
            merged["parent_id"] = parent["id"]
            merged.pop("subcases", None)
            # Model-channel subcases only assert plan_fixture + model_source.
            merged.pop("assert_plan_types_include", None)
            merged.pop("assert_plan_types_exclude", None)
            merged.pop("assert_flow_mode", None)
            merged.pop("assert_qa_white_bg_relaxed", None)
            expanded.append(merged)
    return expanded


def _state_from_case(case: dict) -> dict:
    attachments = list(case.get("sidebar_attachments") or case.get("attachments") or [])
    state: dict[str, Any] = {
        "messages": [HumanMessage(content=str(case.get("utterance") or ""))],
        "sidebar_attachments": attachments,
    }
    if case.get("requested_skill_id"):
        state["requested_skill_id"] = case["requested_skill_id"]
    return state


def _plan_from_fixture(case: dict) -> dict:
    fixture = case.get("plan_fixture")
    if not fixture:
        raise AssertionError(f"{case['id']}: missing plan_fixture")
    raw = json.dumps(fixture, ensure_ascii=False)
    return parse_product_visual_plan(raw).model_dump(mode="json")


def _type_ids(plan: dict) -> set[str]:
    return {
        str(t.get("type_id") or "").strip()
        for t in (plan.get("image_types") or [])
        if isinstance(t, dict) and t.get("type_id")
    }


def _assert_plan_types(plan: dict, case: dict) -> list[str]:
    errors: list[str] = []
    ids = _type_ids(plan)
    for required in case.get("assert_plan_types_include") or []:
        if required not in ids:
            errors.append(f"missing type {required!r}, got {sorted(ids)}")
    for forbidden in case.get("assert_plan_types_exclude") or []:
        if forbidden in ids:
            errors.append(f"forbidden type {forbidden!r} present")
    return errors


def _assert_all_target_type_image(plan: dict) -> list[str]:
    errors: list[str] = []
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        target = str(image_type.get("target_type") or "image")
        if target != "image":
            errors.append(f"{image_type.get('type_id')}: target_type={target!r}")
    return errors


def _assert_human_presence(plan: dict) -> list[str]:
    ids = _type_ids(plan)
    if ids & HUMAN_PRESENCE_TYPE_IDS:
        return []
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        for scheme in image_type.get("schemes") or []:
            if not isinstance(scheme, dict):
                continue
            key_elements = scheme.get("key_elements") or {}
            if isinstance(key_elements, dict) and key_elements.get("human_presence"):
                return []
    return ["no human_presence type or key_elements in plan"]


def _assert_model_source(plan: dict, expected: str) -> list[str]:
    found: set[str] = set()
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        for scheme in image_type.get("schemes") or []:
            if not isinstance(scheme, dict):
                continue
            key_elements = scheme.get("key_elements") or {}
            if isinstance(key_elements, dict) and key_elements.get("human_presence"):
                found.add(str(key_elements.get("model_source") or ""))
    if expected in found:
        return []
    return [f"model_source expected {expected!r}, found {sorted(found)}"]


class FakeLLM:
    def __init__(self, content: str) -> None:
        self.content = content

    async def ainvoke(self, _messages: Any) -> Any:
        class Resp:
            def __init__(self, text: str) -> None:
                self.content = text

        return Resp(self.content)


def test_eval_cvs_set_schema(cvs_doc: dict):
    assert cvs_doc.get("schema_version") == 1
    assert len(cvs_doc.get("cases") or []) == 3


def test_eval_cvs_set_minimum_cases(cvs_cases: list[dict]):
    top_level = {c["id"] for c in cvs_cases if not c.get("parent_id")}
    assert top_level == {
        "CVS-01-ecommerce-listing",
        "CVS-02-product-packaging-crab",
        "CVS-03-interior-design",
    }
    assert len(cvs_cases) >= 9, f"expected 3 cases + 6 model subcases, got {len(cvs_cases)}"


def test_eval_cvs_set_route_gold(cvs_cases: list[dict]):
    mismatches: list[str] = []
    for case in cvs_cases:
        if case.get("parent_id"):
            continue
        expected = case.get("assert_flow_mode")
        if not expected:
            continue
        state = _state_from_case(case)
        ctx = assemble_route_context(state)
        decision = decide_route(ctx, valid_skill_ids=VALID_SKILLS)
        if decision.get("flow_mode") != expected:
            mismatches.append(
                f"{case['id']}: flow_mode {decision.get('flow_mode')} != {expected}"
            )
    assert not mismatches, "\n".join(mismatches)


def test_eval_cvs_set_plan_fixture_gold(cvs_cases: list[dict]):
    mismatches: list[str] = []
    for case in cvs_cases:
        case_id = case["id"]
        try:
            plan = _plan_from_fixture(case)
        except Exception as exc:  # noqa: BLE001
            mismatches.append(f"{case_id}: plan parse failed: {exc}")
            continue
        mismatches.extend(f"{case_id}: {e}" for e in _assert_plan_types(plan, case))
        if case.get("assert_all_target_type"):
            mismatches.extend(
                f"{case_id}: {e}" for e in _assert_all_target_type_image(plan)
            )
        if case.get("assert_human_presence_in_delivery"):
            mismatches.extend(f"{case_id}: {e}" for e in _assert_human_presence(plan))
        expected_model = case.get("assert_model_source")
        if expected_model:
            mismatches.extend(
                f"{case_id}: {e}" for e in _assert_model_source(plan, expected_model)
            )
        manifest = build_manifest_from_plan(plan)
        for item in manifest:
            if str(item.get("target_type") or "") != "image":
                mismatches.append(
                    f"{case_id}: manifest item {item.get('key')} target_type != image"
                )
    assert not mismatches, "\n".join(mismatches)


@pytest.mark.asyncio
async def test_eval_cvs_set_plan_node_dry_run(cvs_cases: list[dict]):
    mismatches: list[str] = []
    for case in cvs_cases:
        if case.get("parent_id"):
            continue
        fixture = case.get("plan_fixture")
        if not fixture:
            mismatches.append(f"{case['id']}: missing plan_fixture")
            continue
        llm = FakeLLM(json.dumps(fixture, ensure_ascii=False))
        node = make_plan_product_visual_node(llm=llm, skills_dir=SKILLS_DIR)
        state = _state_from_case(case)
        state["user_brief"] = case.get("utterance")
        state["skill_id"] = case.get("requested_skill_id") or "ecommerce-product-visual"
        out = await node(state)
        if out.get("phase") == "error":
            mismatches.append(f"{case['id']}: plan node error {out.get('last_error')}")
            continue
        plan = out.get("product_visual_plan") or {}
        mismatches.extend(f"{case['id']}: {e}" for e in _assert_plan_types(plan, case))
        if case.get("assert_all_target_type"):
            mismatches.extend(
                f"{case['id']}: {e}" for e in _assert_all_target_type_image(plan)
            )
    assert not mismatches, "\n".join(mismatches)


def test_eval_cvs_set_qa_white_bg_relaxed(cvs_cases: list[dict]):
    case = next(c for c in cvs_cases if c["id"] == "CVS-03-interior-design")
    assert case.get("assert_qa_white_bg_relaxed") is True
    state = _state_from_case(case)
    state["route_context"] = assemble_route_context(state)
    metrics = derive_qa_metrics(state)
    assert metrics.get("scene_kind") == "interior"
    metrics["has_white_bg"] = False
    metrics["sharpness"] = 0.7
    result = evaluate_image_qa(metrics)
    assert result["image_qa_result"] == "pass"
    assert result["phase"] == "plan_product_visual"
