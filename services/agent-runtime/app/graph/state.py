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


def gen_by_key_reducer(left: dict | None, right: dict | None) -> dict | None:
    """Reducer for gen_by_key: per-key shallow merge; None resets (Send fan-out safe)."""
    if right is None:
        return None
    if not left:
        return dict(right)
    out = dict(left)
    for k, v in right.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


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
        "atomic_parse",
        "atomic_create",
        "await_atomic_confirm",
        "clarify",
        "done",
        "error",
        "image_qa",
        "await_image_qa",
        "plan_product_visual",
        "await_scheme_select",
        "split_product_visual",
        "delivery_confirm",
        "await_delivery_confirm",
        "dialog_draft",
        "await_macro_scheme_select",
        "canvas_ssot_commit",
        "decompose_from_ssot",
        "await_shot_confirm",
        "synthesize_gen_prompt",
        "orchestrate_shots",
        "phase1_seed_lazy",
        "phase1_seed_eager",
    ]
    skill_id: str | None
    requested_skill_id: str | None  # explicit Dock/API skill; intake reads each turn
    route_context: dict | None
    route_decision: dict | None
    route_clarify: bool | None
    thread_id: str
    session_id: str
    user_id: str
    prompt_version: str | None  # W19: active skill prompt template version
    flow_mode: Literal[
        "campaign", "single_node", "atomic_create", "atomic_regenerate", "product_visual"
    ] | None  # W28/W29/P4
    focus_node_id: str | None  # W28: canvas node for single-node gen
    atomic_spec: dict | None  # P4: parsed atomic create intent
    atomic_items: list[dict] | None  # P4: multi-item atomic create (spec + node_id)
    atomic_node_id: str | None  # P4: created canvas node id
    atomic_record_id: str | None  # P4: generation record id
    parse_confidence: float | None  # Phase 2: hybrid parse confidence
    clarify_question: str | None  # Phase 2: low-confidence clarify prompt
    clarify_context: dict | None  # P0: route/atomic clarify checkpoint (see clarify_context.py)
    pre_parsed_intent: dict | None  # P0: shortcut from route clarify follow-up
    thinking_summary: str | None  # UX: short routing/parse status for stream UI

    # 工作记忆（轻量；禁止存完整 canvas nodes/edges）
    plan_summary: str
    plan_draft: str | None
    plan_node_id: str | None
    split_manifest: list[SplitManifestItem]
    # P0 修复：node_revise 走 plan(modify) 后，LLM 产出的节点操作列表（rename/add/delete）；
    # split 在 modify 模式下按操作列表 upsert 画布节点。None 表示首轮 create 或 LLM 解析失败回退。
    node_operations: list[dict] | None
    # W3/W15: gen_queue removed; gen_completed/gen_failed removed from checkpoint (P0-02)
    gen_progress_id: str | None  # W15: Pointer to GenProgress table
    context_snapshot_id: str | None  # W18: Pointer to latest ContextSnapshot
    last_error: str | None
    copy_draft: str | None
    copy_node_id: str | None
    copy_revise_only: bool

    # W16: revision counters for force-choice degradation
    plan_revise_count: int
    copy_revise_count: int
    force_choice: Literal["plan_max_revise", "copy_max_revise", "gen_partial"] | None

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

    # Sidebar material entry (per user turn; overwritten each fresh turn)
    sidebar_attachments: list[dict] | None
    sidebar_ref_order: list[str] | None
    sidebar_mentioned_keys: list[str] | None

    # W14: user_brief uses brief_reducer — immutable after first write unless BRIEF_RESET_PREFIX
    user_brief: Annotated[str | None, brief_reducer]
    mode: Literal["create", "modify"] | None
    # W10: decide_plan_mode 计算，供 revise_manifest / compose_confirm / route_after_plan 使用
    is_node_revise: bool | None

    # --- Tier A: W13 presort (split → await_topo → start_gen) ---
    gen_ordered_keys: list[str] | None

    # --- Tier B: gen run transient (start_gen → collect_gen only; see gen_run_state.py) ---
    gen_deps_of: dict[str, list[str]] | None
    gen_by_key: Annotated[dict[str, dict] | None, gen_by_key_reducer]
    gen_completed_keys: Annotated[list[str] | None, reset_or_union]
    gen_failed_keys: Annotated[list[str] | None, reset_or_union]
    gen_needs_user_keys: Annotated[list[str] | None, reset_or_union]
    gen_fail_details: Annotated[dict[str, dict] | None, reset_or_merge]

    # explore_canvas path (Phase 2)
    explore_summary: dict | None
    canvas_commands: list[dict] | None

    # ecommerce-product-visual (Phase 1 image-only)
    product_visual_plan: dict | None
    image_qa_result: Literal["pass", "fail", "remediated"] | None
    image_qa_decision: Literal["none", "retake", "ai_white_bg", "confirm_pass"] | None
    scheme_revision_count: int | None
    phase1_asset_keys: list[str] | None
    delivery_selections: dict[str, str] | None  # type_id -> scheme_id; v2: shot_id -> variant_id
    # product_visual scheme v2 (spec 2026-08-11)
    product_visual_scheme_v2: bool | None
    macro_scheme_draft: str | None
    macro_schemes: list[dict] | None
    selected_macro_scheme_ids: list[str] | None
    macro_scheme_decision: Literal["none", "confirm", "revise", "auto"] | None
    shot_manifest: list[dict] | None
    visual_intent: dict | None
    requires_standard_product_assets: bool | None
    image_qa_reason: str | None
    image_qa_metrics: dict | None
    vision_used: bool | None
