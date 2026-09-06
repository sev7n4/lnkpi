"""Post-cancel intent routing and phase-aware revision state clearing."""

from __future__ import annotations

import re
from typing import Any, Literal

from langgraph.types import Command

from app.graph.hitl_resume import should_resume_interrupt

PostCancelIntent = Literal["gate_resume", "revise", "new_task"]

REVISE_INTENT_HINTS: tuple[str, ...] = (
    "换成",
    "改成",
    "改为",
    "不要",
    "去掉",
    "调整",
    "修改",
    "改一下",
    "只要",
)
NEW_TASK_HINTS: tuple[str, ...] = (
    "另一套",
    "重新做",
    "新任务",
    "换个产品",
    "帮我做一套",
    "从头",
)
REF_MENTION_RE = re.compile(r"@[TIVA]\d+", re.IGNORECASE)

_GEN_STATE_CLEAR: dict[str, None] = {
    "gen_progress_id": None,
    "gen_ordered_keys": None,
    "gen_deps_of": None,
    "gen_by_key": None,
    "gen_completed_keys": None,
    "gen_failed_keys": None,
    "gen_needs_user_keys": None,
    "gen_fail_details": None,
}
_DELIVERY_AND_GEN_CLEAR: dict[str, None] = {
    "delivery_selections": None,
    **_GEN_STATE_CLEAR,
}
_SHOT_AND_DOWNSTREAM_CLEAR: dict[str, None] = {
    "shot_manifest": None,
    "expected_delivery_count": None,
    **_DELIVERY_AND_GEN_CLEAR,
}
_MACRO_AND_DOWNSTREAM_CLEAR: dict[str, None] = {
    "selected_macro_scheme_ids": None,
    "macro_scheme_decision": None,
    **_SHOT_AND_DOWNSTREAM_CLEAR,
}
_QA_AND_DOWNSTREAM_CLEAR: dict[str, None] = {
    "image_qa_result": None,
    "image_qa_decision": None,
    "retake_pending": None,
    "macro_scheme_draft": None,
    "macro_schemes": None,
    **_MACRO_AND_DOWNSTREAM_CLEAR,
}

_IMAGE_QA_PHASES = frozenset(
    {"image_qa", "await_image_qa", "phase1_seed_lazy", "phase1_seed_eager"}
)
_MACRO_PHASES = frozenset(
    {"plan_product_visual", "dialog_draft", "await_macro_scheme_select"}
)
_SHOT_PHASES = frozenset(
    {
        "canvas_ssot_commit",
        "decompose_from_ssot",
        "await_shot_confirm",
        "await_shot_topo_confirm",
        "synthesize_gen_prompt",
        "orchestrate_shots",
    }
)
_GEN_PHASES = frozenset(
    {
        "start_gen",
        "orchestrate_gen",
        "collect_gen",
        "delivery_confirm",
        "await_delivery_confirm",
        "done",
    }
)


def classify_post_cancel_intent(
    message: str,
    *,
    next_nodes: list[str],
    user_decision: str | None = None,
    run_cancelled: bool,
    phase: str | None,
) -> PostCancelIntent | None:
    """Classify the first turn after cancellation by the §4.2 priority rules."""
    if not run_cancelled and phase != "cancelled":
        return None

    text = (message or "").strip()
    if text == "__new_task__":
        return "new_task"

    if next_nodes and should_resume_interrupt(
        text,
        next_nodes,
        user_decision=user_decision,
    ):
        return "gate_resume"

    has_revise_hint = any(hint in text for hint in REVISE_INTENT_HINTS)
    has_new_task_hint = any(hint in text for hint in NEW_TASK_HINTS)
    if has_revise_hint and not has_new_task_hint:
        return "revise"

    if has_new_task_hint or (len(text) >= 12 and REF_MENTION_RE.search(text)):
        return "new_task"
    if len(text) >= 12:
        return "new_task"

    return "revise" if has_revise_hint else "new_task"


def revise_state_clear_for_phase(phase: str | None) -> dict[str, Any]:
    """Return only checkpoint fields that a revision must overwrite."""
    normalized = (phase or "").strip()
    if normalized in _GEN_PHASES:
        return dict(_DELIVERY_AND_GEN_CLEAR)
    if normalized in _SHOT_PHASES:
        return dict(_SHOT_AND_DOWNSTREAM_CLEAR)
    if normalized in _MACRO_PHASES:
        return dict(_MACRO_AND_DOWNSTREAM_CLEAR)
    if normalized in _IMAGE_QA_PHASES:
        return dict(_QA_AND_DOWNSTREAM_CLEAR)

    # A missing/originally-cancelled phase cannot safely retain downstream work.
    return dict(_QA_AND_DOWNSTREAM_CLEAR)


def build_revise_turn_command(*, phase_hint: str | None, update: dict[str, Any]) -> Command:
    """Restart intake with phase-aware CLEAR fields for a revised request."""
    clear = revise_state_clear_for_phase(phase_hint)
    return Command(
        goto="intake",
        update={
            **clear,
            "run_cancelled": None,
            "cancel_reason": None,
            "phase": None,
            **update,
        },
    )
