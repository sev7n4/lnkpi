"""Integration-style tests for plan → confirm → split graph (FakeNest + FakeLLM)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.builder import build_agent_graph

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"

PLAN_MARKDOWN = """# 卫生洁具企业营销方案

## 定位
高端卫浴电商详情页。

## 视觉资产/白底图
白底产品主图。

## 视觉资产/主图
基于白底的电商主图。
"""


class FakeLLM:
    """Queue of string responses for ainvoke/ainvoke."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[Any] = []

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        self.calls.append(messages)
        if not self.responses:
            raise RuntimeError("FakeLLM: no responses left")
        return AIMessage(content=self.responses.pop(0))

    def invoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        self.calls.append(messages)
        if not self.responses:
            raise RuntimeError("FakeLLM: no responses left")
        return AIMessage(content=self.responses.pop(0))


class FakeNest:
    """Records Nest canvas tool calls without HTTP."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.nodes: dict[str, dict[str, Any]] = {}
        self._seq = 0

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        nid = node_id or "prompt-plan-1"
        self.calls.append(
            ("upsert_prompt_node", {"prompt": prompt, "content": content, "node_id": node_id})
        )
        self.nodes[nid] = {
            "id": nid,
            "type": "prompt",
            "data": {"prompt": prompt, "content": content, "title": prompt},
        }
        return {"nodeId": nid, "actions": []}

    async def get_node(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("get_node", {"node_id": node_id}))
        if node_id not in self.nodes:
            raise KeyError(node_id)
        return self.nodes[node_id]

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        mapping = []
        for item in items:
            self._seq += 1
            nid = f"{item['targetType']}-{self._seq}"
            mapping.append({"key": item["key"], "nodeId": nid})
            self.nodes[nid] = {
                "id": nid,
                "type": item["targetType"],
                "data": {
                    "title": item.get("title", ""),
                    "manifestKey": item["key"],
                    "prompt": item.get("prompt", ""),
                },
            }
        return {"nodes": mapping, "actions": []}

    async def connect_nodes(self, edges: list[dict[str, str]]) -> dict[str, Any]:
        self.calls.append(("connect_nodes", edges))
        return {"actions": []}

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        self.calls.append(("set_node_prompt", {"node_id": node_id, "prompt": prompt}))
        return {"nodeId": node_id, "actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        self.calls.append(("attach_refs", {"node_id": node_id, "ref_order": ref_order}))
        return {"nodeId": node_id, "actions": []}


def _batch_keys(nest: FakeNest) -> set[str]:
    for name, payload in nest.calls:
        if name == "add_nodes_batch":
            return {item["key"] for item in payload}
    return set()


@pytest.mark.asyncio
async def test_confirm_then_split_creates_image_skeletons():
    nest = FakeNest()
    # plan markdown, then classification reply "确认" if heuristic needs LLM fallback
    llm = FakeLLM(responses=[PLAN_MARKDOWN, "确认"])
    graph = build_agent_graph(
        nest=nest,
        llm=llm,
        skills_dir=SKILLS_DIR,
    )
    config = {"configurable": {"thread_id": "thread-confirm-1"}}

    state1 = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我设计一套卫生洁具的营销方案。")],
            "session_id": "session-1",
            "thread_id": "thread-confirm-1",
            "user_id": "user-1",
        },
        config,
    )
    assert state1["awaiting_user"] is True
    assert state1["plan_node_id"]
    assert state1["skill_id"] == "enterprise-marketing-campaign"
    assert any(c[0] == "upsert_prompt_node" for c in nest.calls)

    state2 = await graph.ainvoke(
        {"messages": [HumanMessage(content="确认，按这个拆并出图")]},
        config,
    )
    keys = _batch_keys(nest)
    assert "white_bg" in keys
    assert "hero_main" in keys
    assert state2["phase"] == "done"
    assert state2["user_decision"] == "confirm"
    assert state2["split_manifest"]
    assert all(item.get("node_id") for item in state2["split_manifest"])
    # State must not hold full canvas nodes/edges
    assert "nodes" not in state2
    assert "edges" not in state2


@pytest.mark.asyncio
async def test_revise_returns_to_plan():
    nest = FakeNest()
    llm = FakeLLM(
        responses=[
            PLAN_MARKDOWN,
            "# 修订方案\n更偏天猫详情页。\n",
        ]
    )
    graph = build_agent_graph(nest=nest, llm=llm, skills_dir=SKILLS_DIR)
    config = {"configurable": {"thread_id": "thread-revise-1"}}

    await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我设计卫生洁具营销方案")],
            "session_id": "session-2",
            "thread_id": "thread-revise-1",
            "user_id": "user-1",
        },
        config,
    )
    plan_calls_before = sum(1 for c in nest.calls if c[0] == "upsert_prompt_node")

    state2 = await graph.ainvoke(
        {"messages": [HumanMessage(content="改成更偏天猫详情页")]},
        config,
    )
    plan_calls_after = sum(1 for c in nest.calls if c[0] == "upsert_prompt_node")
    assert plan_calls_after > plan_calls_before
    assert state2["awaiting_user"] is True
    assert state2["user_decision"] == "none"
    assert state2["phase"] == "await_confirm"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)
