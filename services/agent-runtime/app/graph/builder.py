"""W6: Agent graph — intake + 3 gate regions + split + chat + done."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.chat import make_chat_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.split import make_split_node
from app.graph.state import AgentRuntimeState
from app.graph.subgraphs.confirm_gate import register_confirm_gate
from app.graph.subgraphs.copy_gate import register_copy_gate
from app.graph.subgraphs.topo_gate import register_topo_gate


def route_after_intake(state: AgentRuntimeState) -> str:
    if state.get("skill_id"):
        return "decide_plan_mode"
    return "chat"


def route_after_split(state: AgentRuntimeState) -> str:
    if state.get("gen_order_error"):
        return "done"
    # modify split (node_revise) must return to topo gate — END caused intake replan on「确认出图」
    if state.get("mode") == "modify":
        return "await_topo"
    return "draft_copy"


def build_agent_graph(
    *,
    nest: Any,
    llm: Any,
    skills_dir: str | Path,
    checkpointer: Any | None = None,
):
    """Compile intake → confirm_gate → split → copy_gate → topo_gate → done."""
    skills_path = Path(skills_dir)
    graph = StateGraph(AgentRuntimeState)

    graph.add_node("intake", make_intake_node(skills_path))
    graph.add_node("chat", make_chat_node(llm=llm))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("done", make_done_node())

    register_confirm_gate(graph, nest=nest, llm=llm, skills_dir=skills_path)
    register_copy_gate(graph, nest=nest, llm=llm)
    register_topo_gate(graph, nest=nest)

    graph.add_edge(START, "intake")
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {"decide_plan_mode": "decide_plan_mode", "chat": "chat"},
    )
    graph.add_edge("chat", END)
    graph.add_edge("write_plan_node", "split")
    graph.add_conditional_edges(
        "split",
        route_after_split,
        {"draft_copy": "draft_copy", "await_topo": "await_topo", "done": "done"},
    )
    graph.add_edge("done", END)

    saver = checkpointer if checkpointer is not None else MemorySaver()
    return graph.compile(
        checkpointer=saver,
        interrupt_before=[
            "await_confirm",
            "await_topo",
            "await_copy_confirm",
        ],
    )
