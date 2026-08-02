from __future__ import annotations

import logging
from typing import Annotated, Literal, TypedDict

from langgraph.graph.message import add_messages

logger = logging.getLogger(__name__)

# W14: prefix signals brief_reducer to replace (fresh campaign) instead of rejecting overwrite
BRIEF_RESET_PREFIX = "\0reset\0"


def brief_reducer(left: str | None, right: str | None) -> str | None:
    """W14: first non-empty write wins; fresh campaign uses BRIEF_RESET_PREFIX + text."""
    if right is None:
        return left
    if str(right).startswith(BRIEF_RESET_PREFIX):
        new = str(right)[len(BRIEF_RESET_PREFIX) :].strip()
        return new or None
    new = str(right).strip()
    if not new:
        return left
    if left and str(left).strip():
        logger.warning("brief_reducer: rejected overwrite of user_brief")
        return left
    return new


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
    # Transient bridge: collect_gen → done within one run (not long-lived checkpoint state)
    gen_completed: list[str] | None
    gen_failed: list[dict] | None
    last_error: str | None
    copy_draft: str | None
    copy_node_id: str | None
    copy_revise_only: bool

    # node_revise: 拓扑确认门下检测到"节点内容修改"意图（改为/调整/增加等），
    # 回退到 plan 走 modify 模式增量修改方案，区别于 topo_revise（纯拓扑删除）
    user_decision: Literal[
        "none", "confirm", "revise", "confirm_gen", "topo_revise", "node_revise", "copy_write"
    ] | None

    # SoT snapshots — persisted at write_plan / split for copy harness fallbacks
    copy_sot_brief: str | None
    copy_sot_plan: str | None
    copy_alignment_ok: bool | None
    copy_write_blocked: bool | None

    # W14: user_brief uses brief_reducer — immutable after first write unless BRIEF_RESET_PREFIX
    user_brief: Annotated[str | None, brief_reducer]
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
