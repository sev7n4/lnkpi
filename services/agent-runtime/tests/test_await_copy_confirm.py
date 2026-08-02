from __future__ import annotations

from typing import Any

import pytest

from app.graph.nodes.await_copy_confirm import classify_copy_decision, make_await_copy_confirm_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from langchain_core.messages import HumanMessage


def test_classify_write_copy():
    assert classify_copy_decision("写入主文案") == "confirm"
    assert classify_copy_decision("改成更强调节水") == "revise"
    assert classify_copy_decision("随便看看") == "none"


@pytest.mark.asyncio
async def test_await_copy_confirm_sets_revise_flag():
    node = make_await_copy_confirm_node()
    out = await node({"messages": [HumanMessage(content="改成更强调节水")]})
    assert out["user_decision"] == "revise"
    assert out["copy_revise_only"] is True


@pytest.mark.asyncio
async def test_write_copy_persists_draft():
    class FakeNest:
        def __init__(self) -> None:
            self.calls: list[tuple[str, Any]] = []

        async def set_node_content(self, node_id: str, content: str) -> dict:
            self.calls.append(("set_node_content", (node_id, content)))
            return {"actions": []}

        async def emit_task_update(self, **payload: Any) -> None:
            self.calls.append(("emit_task_update", payload))

    nest = FakeNest()
    node = make_write_copy_node(nest=nest)
    out = await node(
        {
            "copy_node_id": "t1",
            "copy_draft": "# lnkpi 耳机\nTWS 蓝牙耳机正文。",
            "user_brief": "请帮我做一个lnkpi蓝牙耳机营销方案",
            "plan_draft": "| 产品品类 | TWS 真无线蓝牙耳机 |",
            "split_manifest": [{"key": "copy_main", "node_id": "t1", "title": "主文案"}],
        }
    )
    assert any(c[0] == "set_node_content" and c[1] == ("t1", "# lnkpi 耳机\nTWS 蓝牙耳机正文。") for c in nest.calls)
    assert out["awaiting_user"] is True
    assert out["phase"] == "await_topo"
    assert any(
        c[0] == "emit_task_update" and c[1].get("status") == "done" for c in nest.calls
    )


@pytest.mark.asyncio
async def test_write_copy_blocks_misaligned_draft():
    class FakeNest:
        def __init__(self) -> None:
            self.calls: list[tuple[str, Any]] = []

        async def set_node_content(self, node_id: str, content: str) -> dict:
            self.calls.append(("set_node_content", (node_id, content)))
            return {"actions": []}

    nest = FakeNest()
    node = make_write_copy_node(nest=nest)
    out = await node(
        {
            "copy_node_id": "t1",
            "copy_draft": "# 破壁机营销\n真正的好破壁机。",
            "user_brief": "请帮我做一个蓝牙耳机营销方案，品牌lnkpi",
            "plan_draft": "| 产品品类 | TWS 真无线蓝牙耳机 |",
            "split_manifest": [{"key": "copy_main", "node_id": "t1", "title": "主文案"}],
        }
    )
    assert nest.calls == []
    assert out["phase"] == "await_copy_confirm"
    assert out.get("copy_write_blocked") is True
    assert "不一致" in out["messages"][0].content or "重新生成" in out["messages"][0].content


@pytest.mark.asyncio
async def test_write_copy_blocks_when_context_missing():
    class FakeNest:
        async def set_node_content(self, node_id: str, content: str) -> dict:
            raise AssertionError("should not write")

    nest = FakeNest()
    node = make_write_copy_node(nest=nest)
    out = await node(
        {
            "copy_node_id": "t1",
            "copy_draft": "# 任意文案",
            "split_manifest": [{"key": "copy_main", "node_id": "t1", "title": "主文案"}],
        }
    )
    assert out["phase"] == "await_copy_confirm"
    assert "上下文" in out["messages"][0].content
