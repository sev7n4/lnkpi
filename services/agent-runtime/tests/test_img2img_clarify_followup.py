"""Img2img clarify follow-up regression tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.builder import route_after_intake
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.nodes.intake import make_intake_node

IMG2IMG = "@I1 这个是女生，@I2 这个是产品，请让这个女生穿上这件衣服"


@pytest.mark.asyncio
async def test_intake_affirmative_after_atomic_clarify_routes_canvas_agent():
    skills = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills)
    out = await intake(
        {
            "messages": [HumanMessage(content="是的")],
            "requested_skill_id": "enterprise-marketing-campaign",
            "skill_id": "enterprise-marketing-campaign",
            "clarify_context": {
                "original_utterance": IMG2IMG,
                "clarify_question": "需要生成一张女生穿冲锋衣的图片吗？",
            },
            "clarify_question": "需要生成一张女生穿冲锋衣的图片吗？",
        }
    )
    assert out["flow_mode"] == "canvas_agent"
    assert out.get("skill_id") is None
    assert route_after_intake(out) == "explore"


def test_clarify_reply_yes_confirms_img2img():
    result = classify_clarify_reply(IMG2IMG, "需要生成吗", "是的")
    assert result != "none"
    assert result["route"] == "canvas_agent"
    assert result["items"][0]["target_type"] == "image"
    assert "穿上" in result["items"][0]["prompt"]
