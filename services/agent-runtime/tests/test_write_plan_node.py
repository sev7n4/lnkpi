from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.write_plan_node import make_write_plan_node


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            ("upsert_prompt_node", {"prompt": prompt, "content": content, "node_id": node_id})
        )
        return {"nodeId": node_id or "prompt-plan-1", "actions": []}


@pytest.mark.asyncio
async def test_write_plan_node_upserts_and_emits_confirmed_summary():
    nest = FakeNest()
    node = make_write_plan_node(nest=nest)
    out = await node(
        {
            "plan_draft": "# 定位\n高端卫浴\n",
            "plan_summary": "高端卫浴电商详情页",
        }
    )
    assert out["plan_node_id"] == "prompt-plan-1"
    assert out["phase"] == "write_plan_node"
    assert any(c[0] == "upsert_prompt_node" for c in nest.calls)
    assert "已确认方案摘要" in out["messages"][0].content
    assert nest.calls[0][1]["prompt"] == "营销方案"
    assert "高端卫浴" in nest.calls[0][1]["content"]
