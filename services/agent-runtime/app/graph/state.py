from __future__ import annotations

from typing import Annotated, Literal, TypedDict

from langgraph.graph.message import add_messages


def reset_or_union(left: list[str] | None, right: list[str] | None) -> list[str] | None:
    """Reducer for parallel Send fan-out: union-dedupe within a run, None resets.

    LangGraph runs multiple gen_node instances in one superstep; without a
    reducer they'd raise ``InvalidUpdateError: Can receive only one value per
    step``. This reducer merges those parallel writes (union, dedupe, order-
    preserving). Returning ``None`` (from start_gen at run start, or collect_gen
    at run end) resets the channel so a re-generation on the same thread does
    not leak the previous run's keys (which would make the scheduler wrongly
    treat nodes as already-completed and skip them).
    """
    if right is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for k in [*(left or []), *(right or [])]:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def reset_or_merge(left: dict | None, right: dict | None) -> dict | None:
    """Reducer for gen_fail_details: shallow-merge within a run, None resets."""
    if right is None:
        return None
    return {**(left or {}), **(right or {})}


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
    # P0 修复：node_revise 走 plan(modify) 后，LLM 产出的节点操作列表（rename/add/delete）；
    # split 在 modify 模式下按操作列表 upsert 画布节点。None 表示首轮 create 或 LLM 解析失败回退。
    node_operations: list[dict] | None
    topology_mode: Literal["full", "trimmed"] | None
    # W3/W15: gen_queue/gen_completed/gen_failed moved to DB (generation record queries)
    # gen_queue: list[str]  # Removed by W3
    # gen_completed: list[str]  # Removed by W3
    # gen_failed: list[dict]  # Removed by W3
    gen_progress_id: str | None  # W15: Pointer to GenProgress table
    # 修复：W15 将 gen_queue/gen_completed/gen_failed 移到 DB，但 start_gen /
    # orchestrate_gen / done 节点仍读写这些字段（DB 迁移未完成）。保留在 state
    # 作为 transient 字段，避免节点 return 时 LangGraph 报 "Key not in schema"。
    # 体积很小（节点 id 列表），不影响 checkpoint 性能；生成完成后由 done 清空。
    gen_queue: list[str] | None
    gen_completed: list[str] | None
    gen_failed: list[dict] | None
    last_error: str | None
    copy_draft: str | None
    copy_node_id: str | None
    copy_revise_only: bool
    # Only arm after「确认出图」(await_topo confirm_gen); not after draft_copy alone
    pending_orchestrate: bool

    # 一期轻量人机
    awaiting_user: bool
    # node_revise: 拓扑确认门下检测到"节点内容修改"意图（改为/调整/增加等），
    # 回退到 plan 走 modify 模式增量修改方案，区别于 topo_revise（纯拓扑删除）
    user_decision: Literal[
        "none", "confirm", "revise", "confirm_gen", "topo_revise", "node_revise"
    ] | None

    # 修复 P0-1/P0-2/P0-3：brief 锚定 + 修改模式
    # user_brief: 首轮用户需求锚定，后续 plan 必须围绕这个 brief 展开（防止主题漂移）
    # mode: "create"（首轮生成新方案）vs "modify"（在已有方案上修改）
    user_brief: str | None
    brief_locked: bool  # True 后 user_brief 不再被覆盖
    mode: Literal["create", "modify"] | None
    # W10: decide_plan_mode 计算，供 revise_manifest / compose_confirm / route_after_plan 使用
    is_node_revise: bool | None

    # W3: Transient fields for Send API fan-out generation.
    # gen_ordered_keys/gen_deps_of/gen_by_key are write-once (start_gen) /
    # clear-once (collect_gen), so plain overwrite is fine.
    # gen_*_keys/gen_fail_details are written by PARALLEL gen_node instances in
    # the same superstep → must use reset_or_union/reset_or_merge reducers.
    # Returning None (start_gen at run start, collect_gen at run end) resets
    # them so a re-generation on the same thread doesn't leak the prior run.
    gen_ordered_keys: list[str] | None  # Topological order of generation keys
    gen_deps_of: dict[str, list[str]] | None  # Dependency graph
    gen_by_key: dict[str, dict] | None  # Manifest items by key
    gen_completed_keys: Annotated[list[str] | None, reset_or_union]  # Completed keys
    gen_failed_keys: Annotated[list[str] | None, reset_or_union]  # Failed keys
    gen_needs_user_keys: Annotated[list[str] | None, reset_or_union]  # Keys needing user
    gen_fail_details: Annotated[dict[str, dict] | None, reset_or_merge]  # key→{node_id,title,reason}
    gen_max_concurrency: int | None  # Concurrency cap for gen_scheduler
