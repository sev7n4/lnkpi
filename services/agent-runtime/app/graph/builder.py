from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.await_confirm import make_await_confirm_node
from app.graph.nodes.await_copy_confirm import make_await_copy_confirm_node
from app.graph.nodes.chat import make_chat_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.draft_copy import make_draft_copy_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.plan import make_plan_node
from app.graph.nodes.split import make_split_node
from app.graph.nodes.write_copy_node import make_write_copy_node
from app.graph.state import AgentRuntimeState


def route_entry(state: AgentRuntimeState) -> str:
    if state.get("awaiting_user") and state.get("phase") == "await_copy_confirm":
        return "await_copy_confirm"
    if state.get("awaiting_user") and state.get("phase") == "await_confirm":
        return "await_confirm"
    return "intake"


def route_after_draft_copy(state: AgentRuntimeState) -> str:
    # Always end the user turn after draft so「写入主文案」is not blocked by image gen.
    # First draft sets pending_orchestrate; stream_run_events kicks orchestrate in background.
    if state.get("pending_orchestrate"):
        return "done"
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
        return "split"
    if decision == "revise":
        return "plan"
    return "end"


def build_agent_graph(
    *,
    nest: Any,
    llm: Any,
    skills_dir: str | Path,
    checkpointer: Any | None = None,
):
    """Compile intake → (chat | plan → await_confirm → …)."""
    skills_path = Path(skills_dir)
    graph = StateGraph(AgentRuntimeState)

    graph.add_node("intake", make_intake_node(skills_path))
    graph.add_node("chat", make_chat_node(llm=llm))
    graph.add_node("plan", make_plan_node(nest=nest, llm=llm, skills_dir=skills_path))
    graph.add_node("await_confirm", make_await_confirm_node(llm=llm))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("draft_copy", make_draft_copy_node(nest=nest, llm=llm))
    graph.add_node("done", make_done_node())
    graph.add_node("await_copy_confirm", make_await_copy_confirm_node())
    graph.add_node("write_copy_node", make_write_copy_node(nest=nest))

    graph.add_conditional_edges(
        START,
        route_entry,
        {
            "intake": "intake",
            "await_confirm": "await_confirm",
            "await_copy_confirm": "await_copy_confirm",
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
        {"split": "split", "plan": "plan", "end": END},
    )
    graph.add_edge("split", "draft_copy")
    graph.add_conditional_edges(
        "draft_copy",
        route_after_draft_copy,
        {"done": "done", "end": END},
    )
    # orchestrate_gen runs in background via stream_run_events (not on sync path)
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
