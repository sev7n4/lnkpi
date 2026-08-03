"""Tests for W8 canvas stage rollback (P0-08)."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph.canvas_stage import commit_stage_or_rollback, rollback_stage_safe
from app.graph.nodes.split import _apply_modify_split
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from app.graph.nodes.write_plan_node import make_write_plan_node


class RollbackNest:
    def __init__(self, *, fail_commit: bool = False) -> None:
        self.rollback_calls = 0
        self.commit_calls = 0
        self._fail_commit = fail_commit

    async def rollback_stage(self) -> dict[str, Any]:
        self.rollback_calls += 1
        return {"cleared": True}

    async def commit_stage(self) -> dict[str, Any]:
        self.commit_calls += 1
        if self._fail_commit:
            raise RuntimeError("commit failed")
        return {"actions": []}


@pytest.mark.asyncio
async def test_rollback_stage_safe_noop_without_method():
    assert await rollback_stage_safe(object()) is False


@pytest.mark.asyncio
async def test_commit_stage_or_rollback_rolls_back_on_failure():
    nest = RollbackNest(fail_commit=True)
    ok, err = await commit_stage_or_rollback(nest)
    assert ok is False
    assert err == "commit failed"
    assert nest.rollback_calls == 1


@pytest.mark.asyncio
async def test_start_gen_rollback_when_commit_fails():
    nest = RollbackNest(fail_commit=True)
    node = make_start_gen_node(nest=nest)
    out = await node(
        {
            "split_manifest": [
                {
                    "key": "hero",
                    "node_id": "img-1",
                    "target_type": "image",
                    "depends_on": [],
                }
            ],
            "gen_ordered_keys": ["hero"],
        }
    )
    assert out["phase"] == "await_topo"
    assert nest.rollback_calls == 1
    assert "画布提交失败" in out["messages"][0].content


@pytest.mark.asyncio
async def test_write_plan_rollback_on_staged_upsert_failure():
    class FailUpsertNest:
        def __init__(self) -> None:
            self.rollback_calls = 0

        async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
            if kwargs.get("stage"):
                raise RuntimeError("nest unavailable")
            return {"nodeId": "plan-1", "actions": []}

        async def rollback_stage(self) -> dict[str, Any]:
            self.rollback_calls += 1
            return {"cleared": True}

    nest = FailUpsertNest()
    node = make_write_plan_node(nest=nest)
    out = await node(
        {
            "plan_node_id": "plan-1",
            "plan_draft": "# 方案\n内容",
            "plan_summary": "摘要",
        }
    )
    assert out["phase"] == "error"
    assert nest.rollback_calls == 1
    assert "回滚" in out["messages"][0].content


@pytest.mark.asyncio
async def test_write_copy_rollback_on_staged_content_failure():
    class FailCopyNest:
        def __init__(self) -> None:
            self.rollback_calls = 0

        async def get_node(self, node_id: str) -> dict[str, Any]:
            return {"data": {"content": ""}}

        async def set_node_content(self, node_id: str, content: str, **kwargs: Any) -> dict:
            if kwargs.get("stage"):
                raise RuntimeError("write blocked")
            return {"actions": []}

        async def rollback_stage(self) -> dict[str, Any]:
            self.rollback_calls += 1
            return {"cleared": True}

    nest = FailCopyNest()
    node = make_write_copy_node(nest=nest)
    out = await node(
        {
            "copy_node_id": "t1",
            "copy_draft": "# lnkpi 耳机\nTWS 蓝牙耳机正文。",
            "user_brief": "请帮我做一个lnkpi蓝牙耳机营销方案",
            "plan_draft": "| 产品品类 | TWS 真无线蓝牙耳机 |",
            "split_manifest": [{"key": "copy_main", "node_id": "t1"}],
        }
    )
    assert out["phase"] == "error"
    assert nest.rollback_calls == 1


@pytest.mark.asyncio
async def test_modify_split_rollback_when_batch_fails_after_rename():
    class StagingNest:
        def __init__(self) -> None:
            self.rollback_calls = 0
            self.prompt_calls = 0

        async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> dict:
            self.prompt_calls += 1
            return {"actions": []}

        async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict:
            raise RuntimeError("batch failed")

        async def rollback_stage(self) -> dict[str, Any]:
            self.rollback_calls += 1
            return {"cleared": True}

    nest = StagingNest()
    out = await _apply_modify_split(
        nest,
        {
            "split_manifest": [
                {"key": "hero", "title": "主图", "node_id": "img-1", "depends_on": []},
            ],
            "node_operations": [
                {"op": "rename", "key": "hero", "title": "新主图", "prompt_hint": "hint"},
                {"op": "add", "key": "scene", "title": "场景", "target_type": "image"},
            ],
        },
        "plan-1",
    )
    assert out["phase"] == "error"
    assert nest.prompt_calls == 1
    assert nest.rollback_calls == 1
    assert out["split_manifest"][0]["title"] == "主图"
