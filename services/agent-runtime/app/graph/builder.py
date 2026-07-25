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
from app.graph.nodes.done import make_done_node
from app.graph.nodes.draft_copy import make_draft_copy_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node
from app.graph.nodes.plan import make_plan_node
from app.graph.nodes.split import make_split_node
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
    # 修复 P0-1：phase=done 后用户再发消息，必须保留 brief + plan_draft 上下文
    # 走 intake 重新进入，但 intake 会基于 state.user_brief/plan_draft 决定 modify vs create
    if state.get("awaiting_user") and state.get("phase") == "await_copy_confirm":
        return "await_copy_confirm"
    if state.get("awaiting_user") and state.get("phase") == "await_topo":
        text = _latest_user_text(state)
        copy_dec = classify_copy_decision(text)
        if copy_dec == "confirm" or (
            copy_dec == "revise" and ("文案" in text or "主文案" in text)
        ):
            return "await_copy_confirm"
        return "await_topo"
    if state.get("awaiting_user") and state.get("phase") == "await_confirm":
        return "await_confirm"
    # 修复 P0-2：phase=done 但有 user_brief + plan_draft → 走 intake 重新进入
    # intake 节点会基于 state.mode (modify/create) 决定下一步
    return "intake"


def route_after_draft_copy(state: AgentRuntimeState) -> str:
    return "end"


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
        return "orchestrate_gen"
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
    graph.add_node("orchestrate_gen", make_orchestrate_gen_node(nest=nest))

    graph.add_conditional_edges(
        START,
        route_entry,
        {
            "intake": "intake",
            "await_confirm": "await_confirm",
            "await_copy_confirm": "await_copy_confirm",
            "await_topo": "await_topo",
        },
    )
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {"plan": "plan", "chat": "chat"},
    )
    graph.add_edge("chat", END)
    graph.add_edge("plan", "await_confirm")
    graph.add_conditional_edges(
        "await_confirm",
        route_after_confirm,
        {"write_plan_node": "write_plan_node", "plan": "plan", "end": END},
    )
    graph.add_edge("write_plan_node", "split")
    graph.add_edge("split", "draft_copy")
    graph.add_conditional_edges(
        "draft_copy",
        route_after_draft_copy,
        {"end": END},
    )
    graph.add_conditional_edges(
        "await_topo",
        route_after_topo,
        {
            "orchestrate_gen": "orchestrate_gen",
            "topo_revise": "topo_revise",
            "plan": "plan",
            "end": END,
        },
    )
    graph.add_edge("topo_revise", END)
    graph.add_edge("orchestrate_gen", "done")
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
    graph.add_edge("write_copy_node", END)

    saver = checkpointer if checkpointer is not None else MemorySaver()
    return graph.compile(checkpointer=saver)
