from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.await_confirm import make_await_confirm_node
from app.graph.nodes.await_copy_confirm import (
    classify_copy_decision,
    make_await_copy_confirm_node,
)
from app.graph.nodes.await_topo import make_await_topo_node
from app.graph.nodes.chat import make_chat_node
from app.graph.nodes.collect_gen import make_collect_gen_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.draft_copy import make_draft_copy_node
from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node
from app.graph.nodes.plan import make_plan_node
from app.graph.nodes.split import make_split_node
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.nodes.topo_revise import make_topo_revise_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from app.graph.nodes.write_plan_node import make_write_plan_node
from app.graph.state import AgentRuntimeState


def _latest_user_text(state: AgentRuntimeState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def route_entry(state: AgentRuntimeState) -> str:
    # W5: 简化路由 - interrupt_before 替代 awaiting_user flag
    # 从 checkpoint 恢复时，LangGraph 会直接进入中断的节点
    # 新对话或 phase=done 后走 intake
    phase = state.get("phase")
    # 如果有 pending_orchestrate 标记，应该进入 start_gen (W3)
    if state.get("pending_orchestrate"):
        return "start_gen"
    # 从 intake 重新进入
    return "intake"


def route_after_draft_copy(state: AgentRuntimeState) -> str:
    # 修复：draft_copy 后进入主文案确认门（await_copy_confirm），而不是直接 END。
    # 否则 await_copy_confirm / write_copy_node / await_topo / start_gen 全部不可达，
    # 流程永远到不了生图/生视频阶段。
    return "await_copy_confirm"


def route_after_copy_confirm(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm":
        return "write_copy_node"
    if decision == "revise":
        return "draft_copy"
    return "end"


def route_after_intake(state: AgentRuntimeState) -> str:
    if state.get("skill_id"):
        return "plan"
    return "chat"


def route_after_plan(state: AgentRuntimeState) -> str:
    """P0 修复：node_revise（拓扑门改节点内容，画布已有节点）跳过方案确认门，直接进
    write_plan_node → split 增量更新画布；revise（方案门改方向，画布未创建）与 create
    保留 await_confirm 让用户确认方案。与 plan.py 的 is_node_revise 判断保持一致。"""
    if state.get("mode") == "modify" and any(
        isinstance(it, dict) and it.get("node_id")
        for it in (state.get("split_manifest") or [])
    ):
        return "write_plan_node"
    return "await_confirm"


def route_after_split(state: AgentRuntimeState) -> str:
    """P0 修复：modify 模式跳过 draft_copy（保留已确认的主文案），直接 END 回到拓扑确认门；
    create 模式继续 draft_copy 生成首轮主文案草稿。"""
    if state.get("mode") == "modify":
        return "end"
    return "draft_copy"


def route_after_confirm(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm":
        return "write_plan_node"
    if decision == "revise":
        return "plan"
    return "end"


def route_after_topo(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "confirm_gen":
        return "start_gen"  # W3: start_gen prepares gen_queue, then routes to orchestrate_gen
    if decision == "topo_revise":
        return "topo_revise"
    # 修复 P0-1：节点内容修改（改为/调整/增加）→ 回退到 plan 走 modify 模式
    # plan 会用 _MODIFY_INSTRUCTION 增量修改方案，保留未提及节点
    if decision == "node_revise":
        return "plan"
    return "end"


def build_agent_graph(
    *,
    nest: Any,
    llm: Any,
    skills_dir: str | Path,
    checkpointer: Any | None = None,
):
    """Compile intake → plan → confirm → write_plan → split → draft → await_topo → gen."""
    skills_path = Path(skills_dir)
    graph = StateGraph(AgentRuntimeState)

    graph.add_node("intake", make_intake_node(skills_path))
    graph.add_node("chat", make_chat_node(llm=llm))
    graph.add_node("plan", make_plan_node(nest=nest, llm=llm, skills_dir=skills_path))
    graph.add_node("await_confirm", make_await_confirm_node(llm=llm))
    graph.add_node("write_plan_node", make_write_plan_node(nest=nest))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("draft_copy", make_draft_copy_node(nest=nest, llm=llm))
    graph.add_node("done", make_done_node())
    graph.add_node("await_copy_confirm", make_await_copy_confirm_node())
    graph.add_node("write_copy_node", make_write_copy_node(nest=nest))
    graph.add_node("await_topo", make_await_topo_node())
    graph.add_node("topo_revise", make_topo_revise_node(nest=nest))

    # W3: New generation nodes using Send API for per-node checkpointing
    graph.add_node("start_gen", make_start_gen_node())
    graph.add_node("gen_node", make_gen_node(nest=nest))
    graph.add_node("collect_gen", make_collect_gen_node(nest=nest))

    # Keep old orchestrate_gen for backward compatibility (can be removed later)
    graph.add_node("orchestrate_gen", make_orchestrate_gen_node(nest=nest))

    graph.add_conditional_edges(
        START,
        route_entry,
        {
            "intake": "intake",
            "start_gen": "start_gen",
        },
    )
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {"plan": "plan", "chat": "chat"},
    )
    graph.add_edge("chat", END)
    # P0 修复：plan 后按 mode 分流（modify→write_plan_node 直接更新画布，create→await_confirm 确认）
    graph.add_conditional_edges(
        "plan",
        route_after_plan,
        {"write_plan_node": "write_plan_node", "await_confirm": "await_confirm"},
    )
    graph.add_conditional_edges(
        "await_confirm",
        route_after_confirm,
        {"write_plan_node": "write_plan_node", "plan": "plan", "end": END},
    )
    graph.add_edge("write_plan_node", "split")
    # P0 修复：split 后按 mode 分流（modify→END 回拓扑门，create→draft_copy 生成主文案）
    graph.add_conditional_edges(
        "split",
        route_after_split,
        {"draft_copy": "draft_copy", "end": END},
    )
    graph.add_conditional_edges(
        "draft_copy",
        route_after_draft_copy,
        {"await_copy_confirm": "await_copy_confirm"},
    )
    graph.add_conditional_edges(
        "await_topo",
        route_after_topo,
        {
            "start_gen": "start_gen",
            "topo_revise": "topo_revise",
            "plan": "plan",
            "end": END,
        },
    )
    graph.add_edge("topo_revise", END)

    # W3: Generation DAG edges
    # start_gen -> orchestrate_gen (prepares gen_queue, existing orchestrate_gen handles execution)
    # orchestrate_gen -> done
    graph.add_edge("start_gen", "orchestrate_gen")
    graph.add_edge("collect_gen", "done")
    graph.add_edge("done", END)

    # Old orchestrate_gen edge (keep for backward compatibility)
    graph.add_edge("orchestrate_gen", "done")

    graph.add_conditional_edges(
        "await_copy_confirm",
        route_after_copy_confirm,
        {
            "write_copy_node": "write_copy_node",
            "draft_copy": "draft_copy",
            "end": END,
        },
    )
    # 修复：write_copy_node 后进入拓扑确认门（await_topo），而不是 END。
    # 这样用户确认主文案后，流程继续到拓扑确认门，再「确认出图」进入生图/生视频。
    graph.add_edge("write_copy_node", "await_topo")

    saver = checkpointer if checkpointer is not None else MemorySaver()
    # W5: 使用 LangGraph 原生 interrupt_before 机制替代 custom awaiting_user flags
    # 在用户确认节点前中断，等待用户输入后从 checkpoint 恢复继续执行
    return graph.compile(
        checkpointer=saver,
        interrupt_before=[
            "await_confirm",
            "await_topo",
            "await_copy_confirm",
        ],
    )
