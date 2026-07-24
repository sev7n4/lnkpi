"""Tests for intake skill gate (no unique-skill fallback)."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.intake import make_intake_node, marketing_intent

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


def test_marketing_intent_true_for_campaign_brief():
    assert marketing_intent("帮我做一套蓝牙音箱天猫详情页营销方案并出图")


def test_marketing_intent_false_for_hello():
    assert not marketing_intent("你好")
    assert not marketing_intent("这个音箱怎么样")


@pytest.mark.asyncio
async def test_intake_hello_sets_no_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node({"messages": [HumanMessage(content="你好")]})
    assert out.get("skill_id") is None


@pytest.mark.asyncio
async def test_intake_marketing_sets_enterprise_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [
                HumanMessage(content="帮我设计一套卫生洁具的电商详情页营销方案")
            ]
        }
    )
    assert out.get("skill_id") == "enterprise-marketing-campaign"
