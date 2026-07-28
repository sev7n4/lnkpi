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

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", {"node_id": node_id}))
        return {"nodeId": node_id, "status": "completed", "actions": []}

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_video_generation", {"node_id": node_id}))
        return {"nodeId": node_id, "status": "completed", "url": "https://cdn.example/v.mp4", "actions": []}

    async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
        self.calls.append(("emit_task_list", items))

    async def emit_task_update(self, **payload: Any) -> None:
        self.calls.append(("emit_task_update", payload))

    async def emit_task_summary(self, **payload: Any) -> None:
        self.calls.append(("emit_task_summary", payload))

    async def emit_text(self, text: str) -> None:
        self.calls.append(("emit_text", text))


def _batch_keys(nest: FakeNest) -> set[str]:
    for name, payload in nest.calls:
        if name == "add_nodes_batch":
            return {item["key"] for item in payload}
    return set()


@pytest.mark.asyncio
async def test_confirm_then_split_creates_image_skeletons():
    nest = FakeNest()
    # plan markdown, confirm classify (unused if heuristic), draft_copy body
    llm = FakeLLM(responses=[PLAN_MARKDOWN, "确认", "# 主文案\n静音洁净\n"])
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
    # W5: interrupt_before 在 await_confirm 前暂停，不会设置 awaiting_user
    assert state1["skill_id"] == "enterprise-marketing-campaign"
    assert not state1.get("plan_node_id")
    # 方案确认前不得写画布
    assert not any(c[0] == "upsert_prompt_node" for c in nest.calls)
    texts1 = [
        str(getattr(m, "content", "") or "")
        for m in (state1.get("messages") or [])
        if getattr(m, "type", None) == "ai" or isinstance(m, AIMessage)
    ]
    assert any("1. 采纳推荐并确认方案" in t for t in texts1)

    # W5: 从 interrupt 恢复需要 aupdate_state + ainvoke(None)
    await graph.aupdate_state(config, {"messages": [HumanMessage(content="1")]}, as_node="await_confirm")
    state2 = await graph.ainvoke(None, config)
    keys = _batch_keys(nest)
    assert "white_bg" in keys
    assert "hero_main" in keys
    assert "product_turnaround" in keys
    assert "model_portrait" in keys
    assert "video_product" in keys
    assert "model" not in keys
    assert "show_video" not in keys
    assert any(c[0] == "upsert_prompt_node" for c in nest.calls)
    assert state2["plan_node_id"]
    # draft_copy ends turn on await_topo; no auto image gen
    assert state2["phase"] == "await_topo"
    assert state2.get("copy_draft")
    assert state2["user_decision"] == "confirm"
    assert state2["split_manifest"]
    assert all(item.get("node_id") for item in state2["split_manifest"])
    assert not state2.get("pending_orchestrate")
    gen_calls = [c for c in nest.calls if c[0] == "run_image_generation"]
    assert gen_calls == []
    assert not state2.get("gen_completed")
    texts2 = [
        str(getattr(m, "content", "") or "")
        for m in (state2.get("messages") or [])
        if getattr(m, "type", None) == "ai" or isinstance(m, AIMessage)
    ]
    assert any("flowchart" in t or "mermaid" in t.lower() or "资产拓扑" in t for t in texts2)
    task_lists = [c for c in nest.calls if c[0] == "emit_task_list"]
    assert task_lists
    assert any(item.get("id") == "white_bg" for item in task_lists[0][1])
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
    assert not any(c[0] == "upsert_prompt_node" for c in nest.calls)

    # W5: 从 interrupt 恢复需要 aupdate_state + ainvoke(None)
    await graph.aupdate_state(config, {"messages": [HumanMessage(content="改成更偏天猫详情页")]}, as_node="await_confirm")
    state2 = await graph.ainvoke(None, config)
    # revise 仍不写画布，直到确认方案
    assert not any(c[0] == "upsert_prompt_node" for c in nest.calls)
    assert state2["user_decision"] == "none"
    assert state2["phase"] == "await_confirm"
    assert not any(c[0] == "add_nodes_batch" for c in nest.calls)


@pytest.mark.asyncio
async def test_await_confirm_none_emits_tip_message():
    """Ambiguous replies while awaiting confirm must not end the turn silently."""
    from app.graph.nodes.await_confirm import _NONE_DECISION_TIP

    nest = FakeNest()
    llm = FakeLLM(
        responses=[
            PLAN_MARKDOWN,
            "none",  # LLM classify for ambiguous user text
        ]
    )
    graph = build_agent_graph(nest=nest, llm=llm, skills_dir=SKILLS_DIR)
    config = {"configurable": {"thread_id": "thread-none-tip-1"}}

    await graph.ainvoke(
        {
            "messages": [HumanMessage(content="帮我设计卫生洁具营销方案")],
            "session_id": "session-none-tip",
            "thread_id": "thread-none-tip-1",
            "user_id": "user-1",
        },
        config,
    )

    # W5: 从 interrupt 恢复需要 aupdate_state + ainvoke(None)
    await graph.aupdate_state(config, {"messages": [HumanMessage(content="请只回复：在线")]}, as_node="await_confirm")
    state2 = await graph.ainvoke(None, config)
    assert state2["user_decision"] == "none"
    assert state2["phase"] == "await_confirm"
    texts = [
        str(getattr(m, "content", "") or "")
        for m in (state2.get("messages") or [])
        if getattr(m, "type", None) == "ai" or isinstance(m, AIMessage)
    ]
    assert any(_NONE_DECISION_TIP in t for t in texts)
