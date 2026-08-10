"""W6: Agent graph — intake + 3 gate regions + split + chat + done."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.apply_sidebar_refs import make_apply_sidebar_refs_node
from app.graph.nodes.chat import make_chat_node
from app.graph.nodes.explore import make_explore_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.clarify_gate import make_clarify_gate_node
from app.graph.subgraphs.product_visual_gate import register_product_visual_gate
from app.graph.nodes.intake import make_intake_node
from app.graph.nodes.split import make_split_node
from app.graph.state import AgentRuntimeState
from app.graph.subgraphs.atomic_create_gate import register_atomic_create_gate
from app.graph.subgraphs.confirm_gate import register_confirm_gate
from app.graph.subgraphs.copy_gate import register_copy_gate
from app.graph.subgraphs.single_node_gate import register_single_node_gate
from app.graph.subgraphs.topo_gate import register_topo_gate


def route_after_intake(state: AgentRuntimeState) -> str:
    if state.get("route_clarify") and state.get("phase") == "clarify":
        return "clarify_gate"
    if state.get("phase") == "clarify" and state.get("clarify_question"):
        return "clarify_gate"
    if state.get("flow_mode") == "atomic_regenerate":
        return "prepare_atomic_regenerate"
    if state.get("flow_mode") == "single_node":
        return "prepare_single_gen"
    if state.get("flow_mode") == "atomic_create":
        return "parse_atomic_intent"
    if state.get("flow_mode") == "product_visual":
        return "image_qa_check"
    if state.get("skill_id"):
        return "decide_plan_mode"
    if state.get("flow_mode") == "explore_canvas":
        return "explore"
    return "chat"


def route_after_split(state: AgentRuntimeState) -> str:
    if state.get("phase") == "error":
        return "done"
    # modify split (node_revise) must return to topo gate — END caused intake replan on「确认出图」
    if state.get("mode") == "modify":
        return "await_topo"
    return "apply_sidebar_refs"


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
    graph.add_node("clarify_gate", make_clarify_gate_node())
    graph.add_node("chat", make_chat_node(llm=llm))
    graph.add_node("explore", make_explore_node(llm=llm, nest=nest))
    graph.add_node("split", make_split_node(nest=nest, skills_dir=skills_path))
    graph.add_node("apply_sidebar_refs", make_apply_sidebar_refs_node(nest=nest))
    graph.add_node("done", make_done_node(nest=nest))

    register_confirm_gate(graph, nest=nest, llm=llm, skills_dir=skills_path)
    register_copy_gate(graph, nest=nest, llm=llm)
    register_topo_gate(graph, nest=nest)
    register_single_node_gate(graph, nest=nest)
    register_atomic_create_gate(graph, nest=nest, llm=llm)
    register_product_visual_gate(graph, nest=nest)

    graph.add_edge(START, "intake")
    graph.add_conditional_edges(
        "intake",
        route_after_intake,
        {
            "prepare_atomic_regenerate": "prepare_atomic_regenerate",
            "prepare_single_gen": "prepare_single_gen",
            "parse_atomic_intent": "parse_atomic_intent",
            "image_qa_check": "image_qa_check",
            "clarify_gate": "clarify_gate",
            "decide_plan_mode": "decide_plan_mode",
            "chat": "chat",
            "explore": "explore",
        },
    )
    graph.add_edge("chat", END)
    graph.add_edge("explore", END)
    graph.add_edge("clarify_gate", END)
    graph.add_edge("write_plan_node", "split")
    graph.add_conditional_edges(
        "split",
        route_after_split,
        {
            "apply_sidebar_refs": "apply_sidebar_refs",
            "await_topo": "await_topo",
            "done": "done",
        },
    )
    graph.add_edge("apply_sidebar_refs", "draft_copy")
    graph.add_edge("done", END)

    saver = checkpointer if checkpointer is not None else MemorySaver()
    return graph.compile(
        checkpointer=saver,
        interrupt_before=[
            "await_confirm",
            "await_topo",
            "await_copy_confirm",
            "await_atomic_confirm",
            "await_image_qa",
        ],
    )
