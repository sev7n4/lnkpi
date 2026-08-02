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
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.plan import register_plan_nodes, route_after_plan
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
        return "decide_plan_mode"
    return "chat"


# route_after_plan is now imported from app.graph.nodes.plan (W10: single source of truth
# from compose_confirm's phase field, eliminating duplicated is_node_revise logic)


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
        return "decide_plan_mode"
    return "end"


def route_after_write_copy(state: AgentRuntimeState) -> str:
    if state.get("copy_write_blocked"):
        return "draft_copy"
    return "await_topo"


def route_after_topo(state: AgentRuntimeState) -> str:
    decision = state.get("user_decision") or "none"
    if decision == "copy_write":
        return "write_copy_node"
    if decision == "confirm_gen":
        return "start_gen"  # W3: start_gen inits gen state, then gen_scheduler fans out gen_node via Send
    if decision == "topo_revise":
        return "topo_revise"
    # 修复 P0-1：节点内容修改（改为/调整/增加）→ 回退到 plan 走 modify 模式
    # plan 会用 _MODIFY_INSTRUCTION 增量修改方案，保留未提及节点
    if decision == "node_revise":
        return "decide_plan_mode"
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
    # W10: plan pipeline — 4 single-responsibility nodes replacing monolithic plan.py
    register_plan_nodes(graph, nest=nest, llm=llm, skills_dir=skills_path)
    graph.add_node("await_confirm", make_await_confirm_node(llm=llm))
    graph.add_node("write_plan_node", make_write_plan_node(nest=nest))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("draft_copy", make_draft_copy_node(nest=nest, llm=llm))
    graph.add_node("done", make_done_node())
    graph.add_node("await_copy_confirm", make_await_copy_confirm_node())
    graph.add_node("write_copy_node", make_write_copy_node(nest=nest))
    graph.add_node("await_topo", make_await_topo_node())
    graph.add_node("topo_revise", make_topo_revise_node(nest=nest))

    # W3: New generation nodes using Send API for per-node checkpointing.
    # gen_scheduler is the central arbiter: fans out gen_node via Send and
    # re-runs after each superstep to dispatch the next wave (diamond-safe).
    # orchestrate_gen.py is deprecated (W3 Send fan-out); not registered in the graph.
    graph.add_node("start_gen", make_start_gen_node())
    graph.add_node("gen_scheduler", make_gen_scheduler_node())
    graph.add_node("gen_node", make_gen_node(nest=nest))
    graph.add_node("collect_gen", make_collect_gen_node(nest=nest))

    # W5: fresh runs always enter intake; interrupt resume bypasses START via checkpoint
    graph.add_edge(START, "intake")
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {"decide_plan_mode": "decide_plan_mode", "chat": "chat"},
    )
    graph.add_edge("chat", END)
    # W10: compose_confirm sets phase as SSOT → route_after_plan reads it
    graph.add_conditional_edges(
        "compose_confirm",
        route_after_plan,
        {"write_plan_node": "write_plan_node", "await_confirm": "await_confirm"},
    )
    graph.add_conditional_edges(
        "await_confirm",
        route_after_confirm,
        {"write_plan_node": "write_plan_node", "decide_plan_mode": "decide_plan_mode", "end": END},
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
            "decide_plan_mode": "decide_plan_mode",
            "write_copy_node": "write_copy_node",
            "end": END,
        },
    )
    graph.add_edge("topo_revise", END)

    # W3: Generation DAG edges (Send API fan-out via gen_scheduler).
    # start_gen -> gen_scheduler : kick off the first dispatch wave
    # gen_node   -> gen_scheduler : re-run scheduler after each superstep to dispatch next wave
    # gen_scheduler -> gen_node   : DYNAMIC via Command(goto=[Send("gen_node", ...)]), no static edge
    # gen_scheduler -> collect_gen: DYNAMIC via Command(goto=["collect_gen"]) when nothing to dispatch
    # collect_gen -> done
    graph.add_edge("start_gen", "gen_scheduler")
    graph.add_edge("gen_node", "gen_scheduler")
    graph.add_edge("collect_gen", "done")
    graph.add_edge("done", END)

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
    graph.add_conditional_edges(
        "write_copy_node",
        route_after_write_copy,
        {"draft_copy": "draft_copy", "await_topo": "await_topo"},
    )

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
