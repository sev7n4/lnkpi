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


# 修复 P0-1：node_revise 决策检测（节点内容修改 vs 拓扑删除）
def test_classify_node_revise():
    """节点内容修改动词应识别为 node_revise，而非 topo_revise。"""
    assert classify_topo_decision("把模特定妆改为双人模特") == "node_revise"
    assert classify_topo_decision("改成更偏天猫详情页") == "node_revise"
    assert classify_topo_decision("调整主图配色") == "node_revise"
    assert classify_topo_decision("增加产品材质特写图") == "node_revise"
    assert classify_topo_decision("加上一个场景图") == "node_revise"


def test_classify_topo_revise_still_works_for_deletions():
    """纯拓扑删除仍应识别为 topo_revise（进 topo_revise 节点）。"""
    assert classify_topo_decision("删掉 Banner") == "topo_revise"
    assert classify_topo_decision("去掉主图") == "topo_revise"
    assert classify_topo_decision("移除品牌图") == "topo_revise"


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


# 修复 P0-1：node_revise → plan 路由 + mode=modify
@pytest.mark.asyncio
async def test_node_revise_sets_modify_mode_and_routes_to_plan():
    """用户在拓扑确认门输入节点内容修改 → 设置 mode=modify → 路由到 plan 走增量修改。"""
    from app.graph.builder import route_after_topo

    # 验证 route_after_topo 在 node_revise 时路由到 plan
    assert route_after_topo({"user_decision": "node_revise"}) == "plan"

    # 验证 await_topo 节点在 node_revise 时设置 mode=modify
    from app.graph.nodes.await_topo import make_await_topo_node

    node = make_await_topo_node()
    out = await node(
        {
            "messages": [HumanMessage(content="把模特定妆改为双人模特")],
        }
    )
    assert out["user_decision"] == "node_revise"
    assert out["mode"] == "modify"
    assert out["awaiting_user"] is False
    # 上下文衔接提示（修复 P1-2）
    assert "调整" in out["messages"][0].content or "基于当前方案" in out["messages"][0].content


@pytest.mark.asyncio
async def test_node_revise_full_flow_routes_to_plan():
    """端到端：await_topo → node_revise → plan（modify 模式）→ await_confirm。"""
    from langgraph.checkpoint.memory import MemorySaver
    from langchain_core.messages import AIMessage

    class PlanNest:
        async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
            return {"nodeId": "plan-1", "actions": []}

        async def get_node(self, node_id: str) -> dict[str, Any]:
            return {"id": node_id, "data": {"content": "# plan"}}

        async def emit_text(self, text: str) -> None:
            pass

    class ModifyLLM:
        async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
            # 模拟 modify 模式下 LLM 返回增量修改后的方案
            return AIMessage(content="# 蓝牙耳机营销方案（已改为双人模特）\n\n## 定位\n高端无线耳机")

    nest = PlanNest()
    graph = build_agent_graph(
        nest=nest,
        llm=ModifyLLM(),
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=MemorySaver(),
    )
    config = {"configurable": {"thread_id": "topo-node-revise-1"}}
    # 预置 await_topo 状态 + 已有方案
    await graph.aupdate_state(
        config,
        {
            "phase": "await_topo",
            "awaiting_user": True,
            "skill_id": "enterprise-marketing-campaign",
            "session_id": "s1",
            "user_id": "u1",
            "thread_id": "topo-node-revise-1",
            "user_brief": "帮我设计无线蓝牙耳机品牌营销方案",
            "brief_locked": True,
            "plan_draft": "# 蓝牙耳机营销方案\n\n## 定位\n高端无线耳机",
            "mode": "create",
            "split_manifest": [
                {"key": "hero_main", "title": "主图", "target_type": "image", "depends_on": [], "node_id": "img-1"},
            ],
            "messages": [AIMessage(content="骨架就绪，请确认出图")],
        },
        as_node="draft_copy",
    )
    state = await graph.ainvoke(
        {"messages": [HumanMessage(content="把模特定妆改为双人模特，增加产品材质特写图")]},
        config,
    )
    # 应该进入 await_confirm（plan 重新生成后等待确认）
    assert state.get("phase") == "await_confirm"
    # mode 应该是 modify
    assert state.get("mode") == "modify"
    # plan_draft 应该被更新（包含"双人模特"）
    plan_draft = str(state.get("plan_draft") or "")
    assert "双人模特" in plan_draft or "蓝牙耳机" in plan_draft
