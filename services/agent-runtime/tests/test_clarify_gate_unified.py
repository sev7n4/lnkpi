"""T17: unified clarify_gate — route + atomic paths share checkpoint structure."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage

from app.graph.builder import route_after_intake
from app.graph.nodes.clarify_gate import make_clarify_gate_node
from app.graph.nodes.intake import make_intake_node
from app.graph.subgraphs.atomic_create_gate import route_after_atomic_parse
from app.graph.atomic_parse_schema import parse_outcome_to_state
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[1] / "skills"

_REQUIRED_CTX_KEYS = frozenset({"kind", "original_utterance", "clarify_question"})


def _assert_unified_checkpoint(out: dict, *, kind: str) -> None:
    assert out.get("phase") == "clarify"
    assert out.get("flow_mode") != "chat"
    assert out.get("thinking_summary")
    ctx = out.get("clarify_context")
    assert isinstance(ctx, dict)
    assert _REQUIRED_CTX_KEYS <= set(ctx.keys())
    assert ctx.get("kind") == kind
    assert str(ctx.get("original_utterance") or "").strip()
    assert str(ctx.get("clarify_question") or "").strip()
    msgs = out.get("messages") or []
    assert msgs and str(msgs[0].content).strip()


@pytest.mark.asyncio
async def test_clarify_gate_route_orchestration_path():
    node = make_clarify_gate_node()
    out = await node(
        {
            "route_clarify": True,
            "clarify_question": "回复 1 / 2 / 3",
            "route_context": {
                "utterance": "@T1 请按风格3出图",
                "mentioned_keys": ["T1"],
            },
            "sidebar_mentioned_keys": ["T1"],
        }
    )
    _assert_unified_checkpoint(out, kind="route_orchestration")
    assert out.get("flow_mode") == "clarify_route"
    assert "已看到引用 @T1" in str(out["messages"][0].content)


@pytest.mark.asyncio
async def test_clarify_gate_atomic_parse_path():
    node = make_clarify_gate_node()
    out = await node(
        {
            "clarify_question": "请补充要生成的内容。",
            "route_context": {"utterance": "帮我做一张图", "mentioned_keys": []},
            "clarify_context": {
                "kind": "atomic_parse",
                "original_utterance": "帮我做一张图",
                "clarify_question": "请补充要生成的内容。",
            },
        }
    )
    _assert_unified_checkpoint(out, kind="atomic_parse")
    assert out.get("flow_mode") == "atomic_create"
    assert out.get("route_clarify") is False


@pytest.mark.asyncio
async def test_intake_route_clarify_routes_to_clarify_gate():
    intake = make_intake_node(SKILLS)
    out = await intake(
        {"messages": [HumanMessage(content="天猫蓝牙耳机详情页营销方案")]}
    )
    assert out.get("phase") == "clarify"
    assert route_after_intake(out) == "clarify_gate"


@pytest.mark.asyncio
async def test_intake_regen_clarify_routes_to_clarify_gate():
    intake = make_intake_node(SKILLS)
    out = await intake(
        {"messages": [HumanMessage(content="按刚才那个风格再生成一张")]}
    )
    assert out.get("phase") == "clarify"
    assert route_after_intake(out) == "clarify_gate"


def test_atomic_parse_clarify_routes_to_clarify_gate():
    parsed = parse_outcome_to_state(
        {
            "kind": "clarify",
            "confidence": 0.2,
            "reason": "vague",
            "clarify_question": "请补充要生成的内容。",
        }
    )
    assert parsed["phase"] == "clarify"
    assert route_after_atomic_parse(parsed) == "clarify_gate"
