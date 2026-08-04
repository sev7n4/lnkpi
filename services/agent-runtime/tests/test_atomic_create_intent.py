"""P4: atomic intent routing against eval-intent-set gold labels."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from langchain_core.messages import HumanMessage

from app.graph.atomic_intent import (
    atomic_create_intent,
    atomic_regenerate_intent,
    build_atomic_spec,
    parse_atomic_target_type,
    resolve_intake_route,
)
from app.graph.nodes.intake import make_intake_node

EVAL_PATH = Path(__file__).resolve().parents[1] / "skills" / "atomic-create" / "eval-intent-set.yaml"


@pytest.fixture(scope="module")
def eval_cases() -> list[dict]:
    doc = yaml.safe_load(EVAL_PATH.read_text(encoding="utf-8"))
    return doc["cases"]


def test_eval_routing_gold(eval_cases: list[dict]):
    mismatches: list[str] = []
    for case in eval_cases:
        utterance = case["utterance"]
        focus = case.get("focus_node_id")
        gold = case["gold"]
        route = resolve_intake_route(utterance, focus_node_id=focus)
        if route != gold["route"]:
            mismatches.append(f"{case['id']}: route {route} != {gold['route']}")
            continue
        if gold["route"] == "atomic_create":
            spec = build_atomic_spec(utterance)
            if spec["target_type"] != gold["target_type"]:
                mismatches.append(
                    f"{case['id']}: target {spec['target_type']} != {gold['target_type']}"
                )
            if spec["confirm_gate"] != gold["confirm_gate"]:
                mismatches.append(
                    f"{case['id']}: confirm_gate {spec['confirm_gate']} != {gold['confirm_gate']}"
                )
    assert not mismatches, "\n".join(mismatches)


def test_d1_storyboard_is_text_not_prompt():
    assert parse_atomic_target_type("帮我生成一个蓝牙耳机的分镜提示词") == "text"
    assert parse_atomic_target_type("用提示词模式扩写白底图") == "prompt"


def test_atomic_create_intent_negative_campaign():
    assert not atomic_create_intent("帮我做一套天猫蓝牙耳机详情页营销方案")
    assert atomic_create_intent("帮我生成一个模特人物图")


@pytest.mark.asyncio
async def test_intake_atomic_regenerate_when_prior_node(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="再试一次")],
        "atomic_node_id": "node-abc",
        "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特人物图"},
    })
    assert out["flow_mode"] == "atomic_regenerate"
    assert atomic_regenerate_intent("再试一次")


@pytest.mark.asyncio
async def test_intake_regenerate_phrase_with_prior_node(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="重新生成一张")],
        "atomic_node_id": "node-abc",
        "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特人物图"},
    })
    assert out["flow_mode"] == "atomic_regenerate"
    assert not atomic_create_intent("重新生成一张")


@pytest.mark.asyncio
async def test_intake_atomic_create_wins_over_regenerate_with_prior_node(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="帮我生成一个模特人物图")],
        "atomic_node_id": "node-abc",
        "atomic_spec": {"target_type": "image", "title": "模特图", "prompt": "模特人物图"},
    })
    assert out["flow_mode"] == "atomic_create"
    assert out["flow_mode"] != "atomic_regenerate"


@pytest.mark.asyncio
async def test_intake_regenerate_without_prior_node_falls_through(tmp_path: Path):
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({
        "messages": [HumanMessage(content="再试一次")],
    })
    assert out.get("flow_mode") == "atomic_create"
    assert out.get("phase") == "clarify"
    assert out.get("clarify_question")
    assert out.get("flow_mode") != "atomic_regenerate"
