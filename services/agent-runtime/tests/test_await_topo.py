from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_agent_graph
from app.graph.nodes.await_topo import classify_topo_decision
from app.graph.nodes.topo_revise import make_topo_revise_node


def test_classify_confirm_gen():
    assert classify_topo_decision("确认出图") == "confirm_gen"
    assert classify_topo_decision("开始出图") == "confirm_gen"


def test_classify_topo_revise():
    assert classify_topo_decision("删掉 Banner") == "topo_revise"


# 修复 P0-1：node_revise 决策检测（节点内容修改 vs 拓扑删除）
def test_classify_node_revise():
    """Plan-level revise (更偏/强调) still routes to node_revise."""
    assert classify_topo_decision("更偏天猫详情页") == "node_revise"
    assert classify_topo_decision("强调运动风") == "node_revise"


def test_classify_topo_revise_add_update_query():
    assert classify_topo_decision("删掉 Banner") == "topo_revise"
    assert classify_topo_decision("增加场景图") == "topo_revise"
    assert classify_topo_decision("把模特定妆改为双人模特") == "topo_revise"
    assert classify_topo_decision("查看主图") == "topo_revise"


def test_classify_topo_revise_still_works_for_deletions():
    """纯拓扑删除仍应识别为 topo_revise（进 topo_revise 节点）。"""
    assert classify_topo_decision("删掉 Banner") == "topo_revise"
    assert classify_topo_decision("去掉主图") == "topo_revise"
    assert classify_topo_decision("移除品牌图") == "topo_revise"


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
        self.calls.append(("emit_task_list", items))

    async def emit_text(self, text: str) -> None:
        self.calls.append(("emit_text", text))

    async def remove_nodes(self, node_ids: list[str]) -> dict[str, Any]:
        self.calls.append(("remove_nodes", node_ids))
        return {"actions": []}

    async def get_node(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("get_node", node_id))
        return {"id": node_id, "data": {"prompt": f"prompt-for-{node_id}"}}

    async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("set_node_prompt", {"node_id": node_id, "prompt": prompt, **kwargs}))
        return {"nodeId": node_id, "actions": []}

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {"nodes": [{"key": it["key"], "nodeId": f"new-{it['key']}"} for it in items]}

    async def connect_nodes(self, edges: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("connect_nodes", edges))
        return {"actions": []}


@pytest.mark.asyncio
async def test_topo_revise_loops_back_to_await_topo_interrupt():
    """topo_revise 后应回到 await_topo interrupt，而非 END（否则下一轮从 intake 重跑）。"""
    from langgraph.checkpoint.memory import MemorySaver

    from app.graph.builder import build_agent_graph

    class MinimalNest(FakeNest):
        pass

    graph = build_agent_graph(
        nest=MinimalNest(),
        llm=object(),
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=MemorySaver(),
    )
    config = {"configurable": {"thread_id": "topo-loop-1"}}
    await graph.aupdate_state(
        config,
        {
            "phase": "await_topo",
            "skill_id": "enterprise-marketing-campaign",
            "session_id": "s1",
            "user_id": "u1",
            "thread_id": "topo-loop-1",
            "plan_node_id": "plan-1",
            "split_manifest": [{"key": "hero_main", "title": "主图", "node_id": "img-1"}],
            "messages": [HumanMessage(content="查看主图")],
            "user_decision": "topo_revise",
        },
        as_node="await_topo",
    )
    await graph.ainvoke(None, config)
    snap = graph.get_state(config)
    assert snap.next == ("await_topo",), f"expected interrupt at await_topo, got {snap.next}"


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
async def test_topo_revise_calls_remove_nodes_when_canvas_ids_present():
    nest = FakeNest()
    node = make_topo_revise_node(nest=nest)
    out = await node(
        {
            "messages": [HumanMessage(content="删掉 Banner")],
            "split_manifest": [
                {
                    "key": "copy_main",
                    "title": "主文案",
                    "target_type": "text",
                    "node_id": "text-1",
                    "depends_on": [],
                },
                {
                    "key": "banner",
                    "title": "Banner",
                    "target_type": "image",
                    "node_id": "img-banner",
                    "depends_on": ["copy_main"],
                },
            ],
        }
    )
    assert "banner" not in {str(i["key"]) for i in out["split_manifest"]}
    assert ("remove_nodes", ["img-banner"]) in nest.calls


@pytest.mark.asyncio
async def test_topo_revise_add_node_on_canvas():
    nest = FakeNest()
    node = make_topo_revise_node(nest=nest)
    out = await node(
        {
            "messages": [HumanMessage(content="增加场景图")],
            "plan_node_id": "plan-1",
            "split_manifest": [
                {"key": "hero_main", "title": "主图", "node_id": "img-1", "depends_on": []},
            ],
        }
    )
    keys = {str(i["key"]) for i in out["split_manifest"]}
    assert len(keys) == 2
    assert any(c[0] == "add_nodes_batch" for c in nest.calls)


@pytest.mark.asyncio
async def test_topo_revise_update_node_on_canvas():
    nest = FakeNest()
    node = make_topo_revise_node(nest=nest)
    await node(
        {
            "messages": [HumanMessage(content="把主图改为运动风主图")],
            "split_manifest": [
                {"key": "hero_main", "title": "主图", "node_id": "img-1", "depends_on": []},
            ],
        }
    )
    set_calls = [c for c in nest.calls if c[0] == "set_node_prompt"]
    assert set_calls and set_calls[0][1]["node_id"] == "img-1"


@pytest.mark.asyncio
async def test_topo_revise_query_node():
    nest = FakeNest()
    node = make_topo_revise_node(nest=nest)
    out = await node(
        {
            "messages": [HumanMessage(content="查看主图")],
            "split_manifest": [
                {"key": "hero_main", "title": "主图", "node_id": "img-1", "depends_on": []},
            ],
        }
    )
    assert any(c[0] == "get_node" for c in nest.calls)
    assert "prompt-for-img-1" in out["messages"][0].content


@pytest.mark.asyncio
async def test_confirm_gen_runs_send_api_subgraph():
    """W3: start_gen → gen_scheduler ⇄ gen_node → collect_gen executes generation.

    Replaces the old test that called orchestrate_gen directly. Now exercises the
    full Send-API subgraph via ainvoke and asserts on the legacy bridge fields
    that collect_gen produces for done.py.
    """
    from langgraph.graph import StateGraph, START, END

    from app.graph.nodes.collect_gen import make_collect_gen_node
    from app.graph.nodes.gen_node import make_gen_node
    from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
    from app.graph.nodes.start_gen import make_start_gen_node
    from app.graph.state import AgentRuntimeState

    class GenNest(FakeNest):
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

        async def save_gen_progress(self, **kwargs: Any) -> dict[str, Any]:
            return {"id": "gp-1"}

    nest = GenNest()

    # Build the W3 generation subgraph in isolation
    g = StateGraph(AgentRuntimeState)
    g.add_node("start_gen", make_start_gen_node())
    g.add_node("gen_scheduler", make_gen_scheduler_node())
    g.add_node("gen_node", make_gen_node(nest=nest))
    g.add_node("collect_gen", make_collect_gen_node(nest=nest))
    g.add_edge(START, "start_gen")
    g.add_edge("start_gen", "gen_scheduler")
    g.add_edge("gen_node", "gen_scheduler")
    g.add_edge("collect_gen", END)
    graph = g.compile(checkpointer=MemorySaver())

    manifest = [
        {
            "key": "white_bg",
            "title": "白底图",
            "target_type": "image",
            "auto_generate": True,
            "depends_on": [],
            "node_id": "img-1",
            "prompt_hint": "white",
        }
    ]
    result = await graph.ainvoke(
        {
            "split_manifest": manifest,
            "thread_id": "send-api-smoke",
            "session_id": "s-send-api-smoke",
        },
        {"configurable": {"thread_id": "send-api-smoke"}, "recursion_limit": 100},
    )

    # gen_node ran the image generation
    assert any(c[0] == "run_image_generation" for c in nest.calls)
    # collect_gen persists GenProgress; legacy gen_completed bridge removed (P0-02)
    assert result.get("gen_progress_id") == "gp-1"
    # Tier B cleared; Tier A gen_ordered_keys preserved (P0-03)
    assert result.get("gen_ordered_keys") == ["white_bg"]
    assert result.get("gen_completed_keys") is None


# 修复 P0-1：node_revise → plan 路由 + mode=modify
@pytest.mark.asyncio
async def test_node_revise_sets_modify_mode_and_routes_to_plan():
    """用户在拓扑确认门输入节点内容修改 → 设置 mode=modify → 路由到 plan 走增量修改。"""
    from app.graph.subgraphs.topo_gate import route_after_topo

    # 验证 route_after_topo 在 node_revise 时路由到 plan
    # W10: plan 拆分后路由到 decide_plan_mode（原 plan 入口）
    assert route_after_topo({"user_decision": "node_revise"}) == "decide_plan_mode"

    # 验证 await_topo 节点在 node_revise 时设置 mode=modify
    from app.graph.nodes.await_topo import make_await_topo_node

    node = make_await_topo_node()
    out = await node(
        {
            "messages": [HumanMessage(content="更偏天猫详情页风格")],
        }
    )
    assert out["user_decision"] == "node_revise"
    assert out["mode"] == "modify"
    # 上下文衔接提示（修复 P1-2）
    assert "调整" in out["messages"][0].content or "基于当前方案" in out["messages"][0].content


@pytest.mark.asyncio
async def test_node_revise_full_flow_updates_canvas():
    """端到端：await_topo → node_revise → plan(modify) → write_plan_node → split
    增量更新画布（改 prompt/title + 加节点）→ 回 await_topo 拓扑确认门。"""
    from langgraph.checkpoint.memory import MemorySaver
    from langchain_core.messages import AIMessage

    class PlanNest:
        def __init__(self) -> None:
            self.calls: list[tuple[str, Any]] = []

        async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
            self.calls.append(("upsert_prompt_node", kwargs))
            return {"nodeId": "plan-1", "actions": []}

        async def get_node(self, node_id: str) -> dict[str, Any]:
            return {"id": node_id, "data": {"content": "# plan"}}

        async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
            self.calls.append(("set_node_prompt", {"node_id": node_id, "prompt": prompt, **kwargs}))
            return {"nodeId": node_id, "actions": []}

        async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
            self.calls.append(("add_nodes_batch", items))
            # 模拟新节点创建返回 nodeId
            return {"nodes": [{"key": it["key"], "nodeId": f"new-{it['key']}"} for it in items]}

        async def connect_nodes(self, edges: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
            self.calls.append(("connect_nodes", edges))
            return {"actions": []}

        async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
            self.calls.append(("emit_task_list", items))

        async def emit_text(self, text: str) -> None:
            pass

    class ModifyLLM:
        async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
            sys_content = ""
            for m in messages:
                if getattr(m, "type", None) == "system":
                    sys_content = str(getattr(m, "content", "") or "")
                    break
            # 节点操作调用 → 返回操作列表 JSON（rename model_portrait + add product_material_detail）
            if "节点编辑器" in sys_content:
                return AIMessage(
                    content=(
                        '[{"op":"rename","key":"model_portrait","title":"双人模特定妆","prompt_hint":"双人模特半身肖像"},'
                        '{"op":"add","key":"product_material_detail","title":"产品材质特写图","target_type":"image","prompt_hint":"产品材质微距特写","depends_on":["hero_main"]}]'
                    )
                )
            # 方案正文调用 → 返回修改后的方案 markdown
            return AIMessage(content="# 蓝牙耳机营销方案（已改为双人模特）\n\n## 定位\n高端无线耳机")

    nest = PlanNest()
    graph = build_agent_graph(
        nest=nest,
        llm=ModifyLLM(),
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=MemorySaver(),
    )
    config = {"configurable": {"thread_id": "topo-node-revise-1"}}
    # 预置 await_topo 状态 + 已有方案 + 已有画布节点（split_manifest 有 node_id）
    await graph.aupdate_state(
        config,
        {
            "phase": "await_topo",
            "skill_id": "enterprise-marketing-campaign",
            "session_id": "s1",
            "user_id": "u1",
            "thread_id": "topo-node-revise-1",
            "user_brief": "帮我设计无线蓝牙耳机品牌营销方案",
            "plan_node_id": "plan-1",
            "plan_draft": "# 蓝牙耳机营销方案\n\n## 定位\n高端无线耳机",
            "mode": "create",
            "split_manifest": [
                {"key": "hero_main", "title": "主图", "target_type": "image", "depends_on": [], "node_id": "img-1"},
                {"key": "model_portrait", "title": "模特定妆", "target_type": "image", "depends_on": [], "node_id": "img-2"},
            ],
            "messages": [
                AIMessage(content="骨架就绪，请确认出图"),
                HumanMessage(content="把模特定妆改为双人模特，增加产品材质特写图"),
            ],
            "user_decision": "node_revise",
            "mode": "modify",
        },
        as_node="await_topo",
    )
    state = await graph.ainvoke(None, config)
    # P0 修复后：node_revise 直接更新画布，回到拓扑确认门（不再进 await_confirm）
    assert state.get("phase") == "await_topo"
    assert state.get("mode") == "modify"
    # plan_draft 应该被更新（包含"双人模特"）
    plan_draft = str(state.get("plan_draft") or "")
    assert "双人模特" in plan_draft or "蓝牙耳机" in plan_draft
    # 已有节点应被更新（set_node_prompt 改 model_portrait 的 prompt + title）
    set_calls = [c for c in nest.calls if c[0] == "set_node_prompt"]
    updated_keys = {c[1]["node_id"] for c in set_calls}
    assert "img-2" in updated_keys  # model_portrait 节点被更新
    # 新节点应被批量创建（add_nodes_batch 含 product_material_detail）
    batch_calls = [c for c in nest.calls if c[0] == "add_nodes_batch"]
    assert batch_calls
    new_keys = {it["key"] for it in batch_calls[0][1]}
    assert "product_material_detail" in new_keys
    # split_manifest 应包含新增节点
    final_keys = {str(it.get("key")) for it in (state.get("split_manifest") or [])}
    assert "product_material_detail" in final_keys
    assert "model_portrait" in final_keys


@pytest.mark.asyncio
async def test_modify_split_pauses_at_await_topo_interrupt():
    """modify split 后应 interrupt 在 await_topo（非 END），以便「确认出图」能路由 start_gen。"""
    from langgraph.checkpoint.memory import MemorySaver
    from langchain_core.messages import AIMessage, HumanMessage

    from app.graph.builder import build_agent_graph

    class MinimalNest:
        async def upsert_prompt_node(self, **kwargs: Any) -> dict[str, Any]:
            return {"nodeId": "plan-1", "actions": []}

        async def get_node(self, node_id: str) -> dict[str, Any]:
            return {"id": node_id, "data": {}}

        async def set_node_prompt(self, node_id: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
            return {"nodeId": node_id, "actions": []}

        async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
            return {"nodes": [{"key": it["key"], "nodeId": f"n-{it['key']}"} for it in items]}

        async def connect_nodes(self, edges: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
            return {"actions": []}

        async def emit_task_list(self, items: list[dict[str, Any]]) -> None:
            pass

        async def emit_text(self, text: str) -> None:
            pass

        async def commit_stage(self) -> dict[str, Any]:
            return {"actions": []}

    class MinimalLLM:
        async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
            return AIMessage(content='[{"op":"add","key":"extra_scene","title":"场景图","target_type":"image","prompt_hint":"运动场景"}]')

    graph = build_agent_graph(
        nest=MinimalNest(),
        llm=MinimalLLM(),
        skills_dir=__import__("pathlib").Path(__file__).resolve().parents[1] / "skills",
        checkpointer=MemorySaver(),
    )
    config = {"configurable": {"thread_id": "modify-confirm-gen-1"}}
    await graph.aupdate_state(
        config,
        {
            "phase": "await_topo",
            "skill_id": "enterprise-marketing-campaign",
            "session_id": "s1",
            "user_id": "u1",
            "thread_id": "modify-confirm-gen-1",
            "user_brief": "蓝牙耳机方案",
            "plan_node_id": "plan-1",
            "plan_draft": "# plan",
            "mode": "modify",
            "split_manifest": [{"key": "hero_main", "title": "主图", "node_id": "img-1"}],
            "messages": [
                AIMessage(content="请确认拓扑"),
                HumanMessage(content="更偏运动风详情页"),
            ],
            "user_decision": "node_revise",
        },
        as_node="await_topo",
    )
    await graph.ainvoke(None, config)
    snap = graph.get_state(config)
    assert snap.next == ("await_topo",), f"expected interrupt at await_topo, got {snap.next}"

    await graph.ainvoke(None, config)
    snap = graph.get_state(config)
    assert snap.next == ("await_topo",), f"expected interrupt at await_topo, got {snap.next}"
