from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph, route_entry
from app.graph.nodes.await_topo import classify_topo_decision
from app.graph.nodes.topo_revise import make_topo_revise_node


def test_classify_confirm_gen():
    assert classify_topo_decision("确认出图") == "confirm_gen"
    assert classify_topo_decision("开始出图") == "confirm_gen"


def test_classify_topo_revise():
    assert classify_topo_decision("删掉 Banner") == "topo_revise"


def test_route_entry_await_topo():
    assert (
        route_entry({"awaiting_user": True, "phase": "await_topo", "messages": []})
        == "await_topo"
    )


def test_route_entry_await_topo_prefers_copy_confirm():
    assert (
        route_entry(
            {
                "awaiting_user": True,
                "phase": "await_topo",
                "messages": [HumanMessage(content="写入主文案")],
            }
        )
        == "await_copy_confirm"
    )


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
        self.calls.append(("emit_task_list", items))

    async def emit_text(self, text: str) -> None:
        self.calls.append(("emit_text", text))


@pytest.mark.asyncio
async def test_topo_revise_removes_by_title():
    nest = FakeNest()
    node = make_topo_revise_node(nest=nest)
    out = await node(
        {
            "messages": [HumanMessage(content="删掉 Banner")],
            "split_manifest": [
                {"key": "copy_main", "title": "主文案", "target_type": "text", "depends_on": []},
                {"key": "banner", "title": "Banner", "target_type": "image", "depends_on": ["copy_main"]},
                {
                    "key": "hero_main",
                    "title": "主图",
                    "target_type": "image",
                    "depends_on": ["banner"],
                },
            ],
        }
    )
    keys = {str(i["key"]) for i in out["split_manifest"]}
    assert "banner" not in keys
    assert "copy_main" in keys
    assert out["phase"] == "await_topo"
    assert "flowchart" in out["messages"][0].content or "资产拓扑" in out["messages"][0].content


@pytest.mark.asyncio
async def test_confirm_gen_runs_orchestrate_sync():
    class GenNest(FakeNest):
        async def get_node(self, node_id: str) -> dict[str, Any]:
            return {"id": node_id, "type": "image", "data": {}}

        async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
            return {"nodeId": node_id, "actions": []}

        async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
            return {"nodeId": node_id, "actions": []}

        async def run_image_generation(self, node_id: str) -> dict[str, Any]:
            self.calls.append(("run_image_generation", {"node_id": node_id}))
            return {"nodeId": node_id, "status": "completed", "actions": []}

        async def run_video_generation(self, node_id: str) -> dict[str, Any]:
            self.calls.append(("run_video_generation", {"node_id": node_id}))
            return {"nodeId": node_id, "status": "completed", "actions": []}

        async def emit_task_update(self, **payload: Any) -> None:
            self.calls.append(("emit_task_update", payload))

        async def emit_task_summary(self, **payload: Any) -> None:
            self.calls.append(("emit_task_summary", payload))

    class StubLLM:
        async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
            return AIMessage(content="ok")

    nest = GenNest()
    graph = build_agent_graph(
        nest=nest,
        llm=StubLLM(),
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=MemorySaver(),
    )
    config = {"configurable": {"thread_id": "topo-gen-1"}}
    await graph.aupdate_state(
        config,
        {
            "phase": "await_topo",
            "awaiting_user": True,
            "skill_id": "enterprise-marketing-campaign",
            "session_id": "s1",
            "user_id": "u1",
            "thread_id": "topo-gen-1",
            "split_manifest": [
                {
                    "key": "white_bg",
                    "title": "白底图",
                    "target_type": "image",
                    "auto_generate": True,
                    "depends_on": [],
                    "node_id": "img-1",
                    "prompt_hint": "white",
                }
            ],
            "gen_completed": [],
            "gen_failed": [],
            "messages": [AIMessage(content="骨架就绪")],
        },
        as_node="draft_copy",
    )
    state = await graph.ainvoke(
        {"messages": [HumanMessage(content="确认出图")]},
        config,
    )
    assert any(c[0] == "run_image_generation" for c in nest.calls)
    assert state.get("phase") == "done" or state.get("gen_completed")
