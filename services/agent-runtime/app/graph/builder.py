from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.await_confirm import make_await_confirm_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.orchestrate_gen import make_orchestrate_gen_node
from app.graph.nodes.plan import make_plan_node
from app.graph.nodes.split import make_split_node
from app.graph.state import AgentRuntimeState


def route_entry(state: AgentRuntimeState) -> str:
    if state.get("awaiting_user") and state.get("phase") == "await_confirm":
        return "await_confirm"
    return "intake"


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
    """Compile intake → plan → await_confirm → (revise→plan | confirm→split→orchestrate_gen→done)."""
    skills_path = Path(skills_dir)
    graph = StateGraph(AgentRuntimeState)

    graph.add_node("intake", make_intake_node(skills_path))
    graph.add_node("plan", make_plan_node(nest=nest, llm=llm, skills_dir=skills_path))
    graph.add_node("await_confirm", make_await_confirm_node(llm=llm))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("orchestrate_gen", make_orchestrate_gen_node(nest=nest))
    graph.add_node("done", make_done_node())

    graph.add_conditional_edges(
        START,
        route_entry,
        {"intake": "intake", "await_confirm": "await_confirm"},
    )
    graph.add_edge("intake", "plan")
    graph.add_edge("plan", "await_confirm")
    graph.add_conditional_edges(
        "await_confirm",
        route_after_confirm,
        {"split": "split", "plan": "plan", "end": END},
    )
    graph.add_edge("split", "orchestrate_gen")
    graph.add_edge("orchestrate_gen", "done")
    graph.add_edge("done", END)

    saver = checkpointer if checkpointer is not None else MemorySaver()
    return graph.compile(checkpointer=saver)
