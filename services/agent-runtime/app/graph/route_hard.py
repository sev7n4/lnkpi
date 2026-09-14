"""M3a: Appendix A hard-feature short-circuit (skip decide_lane).

Reuses PRECEDENCE_RULES filtered by HARD_SHORTCIRCUIT_RULE_IDS.
Does not include explore / empty / default_chat — those fall through to
canvas_agent / decide_lane (Task 7). Does not handle clarify_resume
(intake special path, wired in Task 7).
"""

from __future__ import annotations

from typing import Any

from app.graph.atomic_intent_ir import AtomicIntent
from app.graph.route_context import RouteContext
from app.graph.route_features import RouteFeatures
from app.graph.route_precedence import PRECEDENCE_RULES

# Spec appendix A — ordered; excludes explore / empty / default_chat.
HARD_SHORTCIRCUIT_RULE_IDS: tuple[str, ...] = (
    "modify_existing_plan",
    "regen_no_checkpoint",
    "sidebar_img2img",
    "checkpoint_regen",
    "product_visual_explicit",
    "product_visual_intent",
    "ref_backed_generate",
    "focus_gen",
    "explicit_skill_orch",
    "orch_ambiguous",
    "atomic_generate",
    "suspected_vision_clarify",
    "suspected_media_clarify",
    "sidebar_media_question",
)

_RULE_BY_ID = {rule_id: fn for rule_id, fn in PRECEDENCE_RULES}
_HARD_RULE_FNS = [
    (rule_id, _RULE_BY_ID[rule_id]) for rule_id in HARD_SHORTCIRCUIT_RULE_IDS
]


def apply_hard_shortcircuit(
    intent: AtomicIntent,
    features: RouteFeatures,
    ctx: RouteContext,
    *,
    valid_skill_ids: set[str] | None = None,
) -> dict[str, Any] | None:
    """First matching hard rule wins; None if no appendix-A rule matches."""
    for _rule_id, fn in _HARD_RULE_FNS:
        decision = fn(intent, features, ctx, valid_skill_ids)
        if decision is not None:
            return decision
    return None
