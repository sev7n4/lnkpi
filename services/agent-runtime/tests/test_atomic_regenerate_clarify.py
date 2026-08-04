"""Phase 2: intake routes regenerate phrases without checkpoint to clarify."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.builder import route_after_intake
from app.graph.nodes.intake import make_intake_node


@pytest.mark.asyncio
async def test_intake_variant_phrase_without_checkpoint_clarifies():
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake({"messages": [HumanMessage(content="按刚才那个风格再生成一张")]})
    assert out["phase"] == "clarify"
    assert route_after_intake(out) == "clarify_atomic_intent"


@pytest.mark.asyncio
async def test_parse_clarify_state_has_no_duplicate_message():
    from app.graph.atomic_parse_schema import parse_outcome_to_state

    state = parse_outcome_to_state(
        {
            "kind": "clarify",
            "confidence": 0.2,
            "reason": "vague",
            "clarify_question": "请补充要生成的内容。",
        }
    )
    assert state["phase"] == "clarify"
    assert "messages" not in state
