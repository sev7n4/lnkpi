from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.draft_copy import make_draft_copy_node


class FakeLLM:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
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
    assert out["phase"] == "await_topo"
    assert out["awaiting_user"] is True
    assert out["copy_node_id"] == "t1"
    assert out["pending_orchestrate"] is False
    assert "静音" in (out["copy_draft"] or "")
    assert any(
        c[0] == "emit_task_update" and c[1].get("status") == "needs_user"
        for c in nest.calls
    )


@pytest.mark.asyncio
async def test_draft_copy_revise_skips_pending_orchestrate():
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
    assert out["pending_orchestrate"] is False
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
