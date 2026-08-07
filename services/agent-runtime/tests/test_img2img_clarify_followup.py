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
async def test_intake_affirmative_after_atomic_clarify_stays_atomic():
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
    assert out["flow_mode"] == "atomic_create"
    assert out.get("skill_id") is None
    assert route_after_intake(out) == "parse_atomic_intent"


def test_clarify_reply_yes_confirms_img2img():
    result = classify_clarify_reply(IMG2IMG, "需要生成吗", "是的")
    assert result != "none"
    assert result["route"] == "atomic_create"
    assert result["items"][0]["target_type"] == "image"
    assert "穿上" in result["items"][0]["prompt"]


@pytest.mark.asyncio
async def test_parse_skips_clarify_for_sidebar_img2img():
    from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node

    node = make_parse_atomic_intent_node()
    out = await node(
        {
            "messages": [HumanMessage(content=IMG2IMG)],
            "sidebar_mentioned_keys": ["I1", "I2"],
            "route_decision": {"reason": "sidebar_img2img_p1", "flow_mode": "atomic_create"},
            "route_context": {
                "utterance": IMG2IMG,
                "mentioned_keys": ["I1", "I2"],
                "sidebar_attachments": [],
            },
        }
    )
    assert out.get("phase") == "atomic_parse"
    assert out.get("atomic_spec")
    assert out.get("atomic_spec", {}).get("target_type") == "image"
