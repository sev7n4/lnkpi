from __future__ import annotations

from typing import Annotated, Literal, TypedDict

from langgraph.graph.message import add_messages


class SplitManifestItem(TypedDict, total=False):
    key: str
    title: str
    target_type: Literal["text", "image", "video"]
    source_section: str
    gen_mode: str | None
    auto_generate: bool
    depends_on: list[str]
    prompt_hint: str
    node_id: str | None
    chain: Literal["product", "model"] | None
    role: Literal["seed", "turnaround", "downstream"] | None


class AgentRuntimeState(TypedDict, total=False):
    # 对话
    messages: Annotated[list, add_messages]

    # 控制
    phase: Literal[
        "intake",
        "plan",
        "await_confirm",
        "write_plan_node",
        "split",
        "draft_copy",
        "await_copy_confirm",
        "write_copy_node",
        "await_topo",
        "orchestrate_gen",
        "done",
        "error",
    ]
    skill_id: str | None
    thread_id: str
    session_id: str
    user_id: str

    # 工作记忆（轻量；禁止存完整 canvas nodes/edges）
    plan_summary: str
    plan_draft: str | None
    plan_node_id: str | None
    focus_node_ids: list[str]
    split_manifest: list[SplitManifestItem]
    topology_mode: Literal["full", "trimmed"] | None
    gen_queue: list[str]
    gen_completed: list[str]
    gen_failed: list[dict]
    last_error: str | None
    copy_draft: str | None
    copy_node_id: str | None
    copy_revise_only: bool
    # Only arm after「确认出图」(await_topo confirm_gen); not after draft_copy alone
    pending_orchestrate: bool

    # 一期轻量人机
    awaiting_user: bool
    user_decision: Literal["none", "confirm", "revise", "confirm_gen", "topo_revise"] | None
