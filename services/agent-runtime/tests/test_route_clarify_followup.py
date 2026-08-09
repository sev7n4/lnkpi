"""T8: route clarify follow-up via intake."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.intake import make_intake_node

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


@pytest.mark.asyncio
async def test_intake_reply_1_after_route_clarify():
    intake = make_intake_node(SKILLS_DIR)
    out = await intake(
        {
            "messages": [HumanMessage(content="1")],
            "clarify_context": {
                "kind": "route_orchestration",
                "original_utterance": "@T1 请按风格3出图",
                "clarify_question": "回复 1 / 2 / 3",
                "mentioned_keys": ["T1"],
            },
            "sidebar_mentioned_keys": ["T1"],
        }
    )
    assert out["flow_mode"] == "atomic_create"
    assert out.get("clarify_question") is None
    assert out.get("clarify_context") is None
    assert out.get("pre_parsed_intent") is not None
    assert out.get("pre_parsed_intent")["items"][0]["prompt"] == "@T1 请按风格3出图"


@pytest.mark.asyncio
async def test_intake_unknown_reply_after_route_clarify_stays_clarify():
    intake = make_intake_node(SKILLS_DIR)
    out = await intake(
        {
            "messages": [HumanMessage(content="随便说说")],
            "clarify_context": {
                "kind": "route_orchestration",
                "original_utterance": "@T1 请按风格3出图",
                "clarify_question": "回复 1 / 2 / 3",
                "mentioned_keys": ["T1"],
            },
        }
    )
    assert out.get("phase") == "clarify"
    assert out.get("route_clarify") is True
    assert "1 / 2 / 3" in (out.get("clarify_question") or "")
    assert out.get("flow_mode") == "chat"


@pytest.mark.asyncio
async def test_intake_reply_2_after_route_clarify_needs_skill():
    intake = make_intake_node(SKILLS_DIR)
    out = await intake(
        {
            "messages": [HumanMessage(content="2")],
            "clarify_context": {
                "kind": "route_orchestration",
                "original_utterance": "天猫详情页营销方案",
                "clarify_question": "回复 1 / 2 / 3",
            },
        }
    )
    assert out.get("skill_id") is None
    assert out.get("phase") == "clarify"
    assert out.get("clarify_question")
    assert "Skill" in (out.get("clarify_question") or "")
