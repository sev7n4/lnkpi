"""Tests for intake skill gate (no unique-skill fallback)."""

from __future__ import annotations

from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.intake import make_intake_node, modify_intent

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


@pytest.mark.asyncio
async def test_intake_hello_sets_no_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node({"messages": [HumanMessage(content="你好")]})
    assert out.get("skill_id") is None


@pytest.mark.asyncio
async def test_intake_explicit_skill_overrides_non_marketing_text():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="你好")],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    assert out.get("skill_id") == "enterprise-marketing-campaign"


@pytest.mark.asyncio
async def test_intake_invalid_requested_skill_falls_back_to_chat():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="你好")],
        "requested_skill_id": "nonexistent-skill",
    })
    assert out.get("skill_id") is None


@pytest.mark.asyncio
async def test_intake_marketing_without_explicit_skill_sets_no_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [
                HumanMessage(content="帮我设计一套卫生洁具的电商详情页营销方案")
            ]
        }
    )
    assert out.get("skill_id") is None
    assert out.get("phase") == "clarify"


@pytest.mark.asyncio
async def test_intake_marketing_with_explicit_skill():
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [
                HumanMessage(content="帮我设计一套卫生洁具的电商详情页营销方案")
            ],
            "requested_skill_id": "enterprise-marketing-campaign",
        }
    )
    assert out.get("skill_id") == "enterprise-marketing-campaign"
    assert out["flow_mode"] == "campaign"


@pytest.mark.asyncio
async def test_intake_first_turn_create_mode_locks_brief():
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [
                HumanMessage(content="帮我做一套洁具详情页营销方案并出图")
            ],
            "requested_skill_id": "enterprise-marketing-campaign",
        }
    )
    assert out["mode"] == "create"
    assert "洁具" in out["user_brief"]


@pytest.mark.asyncio
async def test_intake_modify_intent_sets_modify_mode_and_keeps_brief():
    # 修复 P0-2/P0-3：已有 brief+plan 时用户说修改 → mode=modify + brief 保留
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [HumanMessage(content="把模特定妆改为双人模特")],
            "user_brief": "帮我做一套洁具详情页营销方案",
            "plan_draft": "# 洁具详情页方案\n## 定位...",
        }
    )
    assert out["mode"] == "modify"
    # W14: modify 模式不写入 user_brief，由 reducer 保留 checkpoint 中的锚定 brief
    assert "user_brief" not in out


@pytest.mark.asyncio
async def test_intake_new_product_request_resets_brief_to_create_mode():
    # 修复问题 1 回归：用户做完一轮"洁具"后，明确要做"运动鞋"新方案
    # 必须 mode=create（不是 modify），且 brief 重置为新需求
    # 否则 _MODIFY_INSTRUCTION 的"禁止换行业/换产品"会锁死在旧主题
    node = make_intake_node(SKILLS_DIR)
    out = await node(
        {
            "messages": [
                HumanMessage(content="帮我做一套运动鞋详情页营销方案并出图")
            ],
            "requested_skill_id": "enterprise-marketing-campaign",
            "user_brief": "帮我做一套洁具详情页营销方案",
            "plan_draft": "# 洁具详情页方案\n## 定位...",
        }
    )
    assert out["mode"] == "create", (
        "用户新主题需求必须走 create 模式，否则 modify instruction 会禁止换产品"
    )
    # brief 重置为新需求
    assert "运动鞋" in out["user_brief"]
    assert "洁具" not in out["user_brief"]


@pytest.mark.asyncio
async def test_modify_intent_detects_changelog_keywords():
    # 修复问题 5/6：_MODIFY_HINTS 关键词覆盖
    assert modify_intent("改成运动鞋")
    assert modify_intent("调整定位")
    assert modify_intent("增加一张特写图")
    assert modify_intent("删掉 banner")
    assert modify_intent("改拓扑")
    assert not modify_intent("帮我做一套运动鞋详情页")
    assert not modify_intent("确认方案")


@pytest.mark.asyncio
async def test_intake_prod_img2img_case_atomic():
    node = make_intake_node(SKILLS_DIR)
    u = (
        "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。"
        "保持主图风格，背景，构图不变。"
    )
    out = await node({"messages": [HumanMessage(content=u)]})
    assert out["flow_mode"] == "atomic_create"
    assert out.get("skill_id") is None
