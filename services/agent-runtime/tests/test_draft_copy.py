from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.draft_copy import make_draft_copy_node


class FakeLLM:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.last_messages: list[Any] | None = None

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        self.last_messages = messages
        if not self.responses:
            raise RuntimeError("FakeLLM: no responses left")
        return AIMessage(content=self.responses.pop(0))


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def emit_text(self, text: str) -> None:
        self.calls.append(("emit_text", text))

    async def emit_task_update(self, **payload: Any) -> None:
        self.calls.append(("emit_task_update", payload))

    async def get_node(self, node_id: str) -> dict:
        return {"data": {"content": ""}}


@pytest.mark.asyncio
async def test_draft_copy_sets_gate_and_needs_user():
    nest = FakeNest()
    llm = FakeLLM(responses=["# 主文案\n静音·洁净·极简\n..."])
    node = make_draft_copy_node(nest=nest, llm=llm)
    out = await node(
        {
            "split_manifest": [
                {
                    "key": "copy_main",
                    "title": "主文案",
                    "target_type": "text",
                    "node_id": "t1",
                },
                {
                    "key": "white_bg",
                    "title": "白底图",
                    "target_type": "image",
                    "node_id": "i1",
                },
            ],
            "plan_summary": "卫生洁具方案",
        }
    )
    assert out["phase"] == "await_copy_confirm"
    assert out["copy_node_id"] == "t1"
    assert "静音" in (out["copy_draft"] or "")
    assert any(
        c[0] == "emit_task_update" and c[1].get("status") == "needs_user"
        for c in nest.calls
    )


@pytest.mark.asyncio
async def test_draft_copy_llm_context_includes_brief_and_plan():
    nest = FakeNest()
    llm = FakeLLM(responses=["# 主文案\nlnkpi 耳机\n"])
    node = make_draft_copy_node(nest=nest, llm=llm)
    plan = "# lnkpi 蓝牙耳机方案\n\nTWS 真无线耳机。"
    await node(
        {
            "user_brief": "请帮我做一个蓝牙耳机营销方案，品牌lnkpi",
            "plan_draft": plan,
            "plan_summary": "2.1 市场背景",
            "split_manifest": [
                {
                    "key": "copy_main",
                    "title": "主文案",
                    "target_type": "text",
                    "node_id": "t1",
                },
            ],
        }
    )
    assert llm.last_messages is not None
    human = llm.last_messages[1].content
    assert "用户需求锚定" in human
    assert "lnkpi" in human
    assert "TWS" in human or "蓝牙耳机" in human


@pytest.mark.asyncio
async def test_draft_copy_retries_when_first_draft_misaligned():
    nest = FakeNest()
    llm = FakeLLM(
        responses=[
            "# 天然乳胶枕\n天猫官方旗舰店销售。",
            "# lnkpi Buds Pro\nTWS 蓝牙耳机，主动降噪。",
        ]
    )
    node = make_draft_copy_node(nest=nest, llm=llm)
    plan = "| 产品品类 | TWS 真无线蓝牙耳机 |\n| 品牌名称 | lnkpi |"
    out = await node(
        {
            "user_brief": "请帮我做一个lnkpi蓝牙耳机营销方案",
            "plan_draft": plan,
            "plan_summary": "耳机方案",
            "split_manifest": [
                {
                    "key": "copy_main",
                    "title": "主文案",
                    "target_type": "text",
                    "node_id": "t1",
                },
            ],
        }
    )
    assert len(llm.responses) == 0  # both responses consumed
    assert "lnkpi" in (out["copy_draft"] or "").lower() or "耳机" in (out["copy_draft"] or "")


@pytest.mark.asyncio
async def test_draft_copy_revise_returns_copy_gate():
    nest = FakeNest()
    llm = FakeLLM(responses=["# 修订主文案\n节水优先\n"])
    node = make_draft_copy_node(nest=nest, llm=llm)
    out = await node(
        {
            "copy_revise_only": True,
            "messages": [],
            "split_manifest": [
                {
                    "key": "copy_main",
                    "title": "主文案",
                    "target_type": "text",
                    "node_id": "t1",
                },
            ],
            "plan_summary": "卫生洁具方案",
        }
    )
    assert out["phase"] == "await_copy_confirm"


@pytest.mark.asyncio
async def test_draft_copy_skips_without_text_item():
    nest = FakeNest()
    llm = FakeLLM(responses=["should-not-run"])
    node = make_draft_copy_node(nest=nest, llm=llm)
    out = await node(
        {
            "split_manifest": [
                {"key": "white_bg", "title": "白底图", "target_type": "image", "node_id": "i1"},
            ],
        }
    )
    assert out == {}
    assert nest.calls == []
