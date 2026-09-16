"""P1: L0 precedence table — single conflict resolution protocol (RU-4, RU-5)."""

from __future__ import annotations

import re
from typing import Any, Callable

from app.graph.atomic_intent import (
    is_regenerate_new_variant,
    regen_intent,
    regenerate_phrase_intent,
    resolve_intake_route,
)
from app.graph.composition_route import (
    is_composition_confirm_chip,
    is_composition_structure_utterance,
    is_live_composition_pending,
)
from app.graph.atomic_intent_ir import AtomicIntent, is_ref_media_generation
from app.graph.clarify_reply import ClarifyReplyResult, classify_clarify_reply
from app.graph.intent import focus_gen_intent, modify_intent
from app.graph.l0_action import (
    SIDEBAR_SINGLE_EDIT_VERBS,
    TRANSFORM_VERBS,
    detect_l0_action,
    has_preserve_intent,
)
from app.graph.route_context import RouteContext
from app.graph.route_features import RouteFeatures, orchestration_campaign_signal

ECOMMERCE_PRODUCT_VISUAL_SKILL = "ecommerce-product-visual"

# Multi-type visual taxonomy — not industry-specific routing (L8 / design §5.5)
_PRODUCT_VISUAL_TYPE_PHRASES = (
    "主图",
    "场景图",
    "详情图",
    "模特",
    "包装",
    "海报",
    "卖点",
    "效果图",
    "展示图",
    "推广图",
    "电商图",
    "视觉",
    "定稿",
    "搭配板",
    "置入",
    "空间",
)
_PRODUCT_VISUAL_MULTI_INDICATORS = (
    "和",
    "以及",
    "再加",
    "同时",
    "一套",
    "几张",
    "多种",
    "多个",
    "各一张",
    "分别",
)

ROUTE_CLARIFY_ORCHESTRATION = (
    "听起来像多节点编排或 Skill 工作流需求。请确认：\n"
    "1）按引用内容单张出图（保留 @T* / @I*）；\n"
    "2）完整编排（请先在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)

_MEDIA_CLARIFY_HEAD = (
    "听起来您想处理图片。请确认：\n"
    "1）直接生成一张图；\n"
    "2）做营销/详情页方案；\n"
)

# 侧栏有图可解读时的三选项文案
ROUTE_CLARIFY_MEDIA = _MEDIA_CLARIFY_HEAD + "3）解读侧栏图片（描述/问答）。\n回复 1 / 2 / 3。"

# 侧栏无图时不提供「解读侧栏图片」，避免给出无法执行的选项
ROUTE_CLARIFY_MEDIA_NO_SIDEBAR = _MEDIA_CLARIFY_HEAD + "回复 1 / 2。"


def route_clarify_media(*, has_sidebar_media: bool) -> str:
    """Media clarify copy — option 3 only when sidebar media actually exists."""
    return ROUTE_CLARIFY_MEDIA if has_sidebar_media else ROUTE_CLARIFY_MEDIA_NO_SIDEBAR

RuleFn = Callable[
    [AtomicIntent, RouteFeatures, RouteContext, set[str] | None],
    dict[str, Any] | None,
]


def _base_decision(
    ctx: RouteContext,
    *,
    flow_mode: str,
    reason: str,
    confidence: float,
    precedence_rule_id: str,
    clarify_question: str | None = None,
    guard_veto: str | None = None,
    is_modify: bool = False,
    intent: AtomicIntent | None = None,
    features: RouteFeatures | None = None,
) -> dict[str, Any]:
    utterance = str(ctx.get("utterance") or "")
    decision: dict[str, Any] = {
        "flow_mode": flow_mode,  # type: ignore[typeddict-item]
        "l0_action": detect_l0_action(utterance),
        "confidence": confidence,
        "reason": reason,
        "clarify_question": clarify_question,
        "guard_veto": guard_veto,
        "is_modify": is_modify,
        "precedence_rule_id": precedence_rule_id,
    }
    if intent is not None:
        decision["atomic_intent"] = intent  # type: ignore[typeddict-unknown-key]
    if features is not None:
        decision["route_features"] = features  # type: ignore[typeddict-unknown-key]
    return decision


def _has_product_photo_attachment(ctx: RouteContext) -> bool:
    if ctx.get("has_product_photo_attachment"):
        return True
    attachments = ctx.get("sidebar_attachments") or []
    for attachment in attachments:
        role = str(attachment.get("role") or "").lower()
        media = str(attachment.get("mediaType") or attachment.get("kind") or "").lower()
        if role == "product" and (not media or media == "image"):
            return True
    return False


def product_visual_intent_signal(utterance: str, *, has_product_photo: bool) -> bool:
    """Lightweight multi-type / visual plan signal — no industry keyword routing."""
    if not has_product_photo:
        return False
    text = (utterance or "").strip()
    if not text:
        return False
    type_hits = sum(1 for phrase in _PRODUCT_VISUAL_TYPE_PHRASES if phrase in text)
    if type_hits >= 2:
        return True
    if type_hits >= 1 and any(marker in text for marker in _PRODUCT_VISUAL_MULTI_INDICATORS):
        return True
    if any(marker in text for marker in ("出一套", "视觉方案", "visual plan", "推广图")):
        return True
    return False


def _valid_skill_id(ctx: RouteContext, valid_skill_ids: set[str] | None) -> str | None:
    requested = str(ctx.get("requested_skill_id") or "").strip()
    if not requested:
        return None
    if valid_skill_ids and requested not in valid_skill_ids:
        return None
    return requested


def _guard_veto(ctx: RouteContext) -> str | None:
    utterance = str(ctx.get("utterance") or "")
    if has_planning_image_conflict(utterance) and not has_preserve_intent(utterance):
        return "planning_image_conflict"
    return None


def has_planning_image_conflict(utterance: str) -> bool:
    from app.graph.planning_guard import has_planning_image_conflict as _conflict

    return _conflict(utterance)


def _sidebar_img2img_match(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext
) -> bool:
    """Multi-image transform OR single sidebar/ref image edit (e.g. 给这只老虎带上眼镜)."""
    utterance = intent.utterance
    keys = list(ctx.get("mentioned_keys") or [])
    image_keys = [k for k in keys if str(k).upper().startswith("I")]
    multi = bool(features.get("has_multi_image_ref"))
    single_ctx = bool(features.get("has_sidebar_media") or features.get("has_image_ref"))
    if not multi and not single_ctx:
        return False
    if multi:
        has_transform = any(v in utterance for v in TRANSFORM_VERBS) or (
            len(image_keys) >= 2 and ("让" in utterance or "请" in utterance)
        )
        return has_transform or bool(features.get("preserve_composition"))
    # Single image: require explicit edit/accessory verbs (not bare 「搭配」).
    return any(v in utterance for v in SIDEBAR_SINGLE_EDIT_VERBS)


def _ref_backed_generate_match(intent: AtomicIntent, features: RouteFeatures) -> bool:
    has_ref = bool(features.get("has_text_ref") or features.get("has_image_ref"))
    if not has_ref:
        return False
    mk = list(intent.mentioned_keys) or None
    if is_ref_media_generation(intent.utterance, mk):
        return True
    if intent.action == "generate" and intent.output_modality in ("image", "video"):
        if "出图" in intent.utterance or "生成图" in intent.utterance or re.search(
            r"按?风格\s*\d+", intent.utterance
        ):
            return True
    return intent.action == "generate" and intent.output_modality in ("image", "video") and has_ref


def _rule_modify_existing_plan(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    checkpoint = ctx.get("checkpoint") or {}
    utterance = intent.utterance
    if (
        checkpoint.get("user_brief")
        and checkpoint.get("plan_draft")
        and modify_intent(utterance)
        and not focus_gen_intent(utterance)
    ):
        return _base_decision(
            ctx,
            flow_mode="campaign",
            reason="modify_existing_plan",
            confidence=0.92,
            precedence_rule_id="modify_existing_plan",
            guard_veto=_guard_veto(ctx),
            is_modify=True,
            intent=intent,
            features=features,
        )
    return None


def _rule_regen_no_checkpoint(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if not features.get("has_regen_checkpoint") and regenerate_phrase_intent(intent.utterance):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="regen_no_checkpoint",
            confidence=0.95,
            precedence_rule_id="regen_no_checkpoint",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_composition_confirm(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if is_composition_confirm_chip(intent.utterance):
        return _base_decision(
            ctx,
            flow_mode="canvas_agent",
            reason="composition_confirm",
            confidence=0.97,
            precedence_rule_id="composition_confirm",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_composition_structure(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if is_composition_structure_utterance(intent.utterance) or is_live_composition_pending(
        ctx.get("composition_pending"), intent.utterance
    ):
        return _base_decision(
            ctx,
            flow_mode="canvas_agent",
            reason="composition_structure",
            confidence=0.96,
            precedence_rule_id="composition_structure",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_checkpoint_regen(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if features.get("has_regen_checkpoint") and regen_intent(intent.utterance):
        return _base_decision(
            ctx,
            # Phase 2d.2: keep rule id; live flow → canvas_agent (no atomic_regenerate subgraph).
            flow_mode="canvas_agent",
            reason="atomic_regenerate_checkpoint",
            confidence=0.96,
            precedence_rule_id="checkpoint_regen",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_sidebar_img2img(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _sidebar_img2img_match(intent, features, ctx):
        return _base_decision(
            ctx,
            flow_mode="canvas_agent",
            reason="sidebar_img2img_p1",
            confidence=0.95,
            precedence_rule_id="sidebar_img2img",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_ref_backed_generate(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if _ref_backed_generate_match(intent, features):
        return _base_decision(
            ctx,
            flow_mode="canvas_agent",
            reason="sidebar_ref_atomic",
            confidence=0.92,
            precedence_rule_id="ref_backed_generate",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_focus_gen(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    focus = ctx.get("focus_node_id")
    utterance = intent.utterance
    route = resolve_intake_route(utterance, focus_node_id=focus)
    if (
        focus
        and route == "single_node"
        and focus_gen_intent(utterance)
        and not modify_intent(utterance)
    ):
        return _base_decision(
            ctx,
            # Phase 2d.2: keep rule id; live flow → canvas_agent (no single_node subgraph).
            flow_mode="canvas_agent",
            reason="single_node_focus",
            confidence=0.93,
            precedence_rule_id="focus_gen",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_product_visual_explicit(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    requested = _valid_skill_id(ctx, valid_skill_ids)
    if requested == ECOMMERCE_PRODUCT_VISUAL_SKILL:
        return _base_decision(
            ctx,
            flow_mode="product_visual",
            reason="explicit_product_visual_skill",
            confidence=0.91,
            precedence_rule_id="product_visual_explicit",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_product_visual_intent(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    has_product_photo = _has_product_photo_attachment(ctx)
    if product_visual_intent_signal(intent.utterance, has_product_photo=has_product_photo):
        return _base_decision(
            ctx,
            flow_mode="product_visual",
            reason="product_photo_multi_visual_intent",
            confidence=0.87,
            precedence_rule_id="product_visual_intent",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_explicit_skill(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    requested = _valid_skill_id(ctx, valid_skill_ids)
    if requested and requested != ECOMMERCE_PRODUCT_VISUAL_SKILL:
        return _base_decision(
            ctx,
            flow_mode="campaign",
            reason="explicit_skill_orchestration",
            confidence=0.90,
            precedence_rule_id="explicit_skill_orch",
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_orch_ambiguous(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    guard = _guard_veto(ctx)
    orch = orchestration_campaign_signal(intent.utterance)
    if guard or (orch and not _valid_skill_id(ctx, valid_skill_ids)):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="orchestration_without_skill",
            confidence=0.75,
            precedence_rule_id="orch_ambiguous",
            clarify_question=ROUTE_CLARIFY_ORCHESTRATION,
            guard_veto=guard,
            intent=intent,
            features=features,
        )
    return None


def _rule_atomic_generate(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    """Deprecated Phase 2a: no longer registered in PRECEDENCE_RULES / HARD.

    Bare media / workflow utterances must fall through to canvas_agent.
    Kept for reference until Phase 2d cleanup.
    """
    return None


def _rule_suspected_vision_clarify(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if features.get("suspected_vision_qa"):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="suspected_vision_qa",
            confidence=0.72,
            precedence_rule_id="suspected_vision_clarify",
            clarify_question=route_clarify_media(
                has_sidebar_media=bool(features.get("has_sidebar_media"))
            ),
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_suspected_media_clarify(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if features.get("suspected_media_create") and not features.get("media_create_high"):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="suspected_media_create",
            confidence=0.70,
            precedence_rule_id="suspected_media_clarify",
            clarify_question=route_clarify_media(
                has_sidebar_media=bool(features.get("has_sidebar_media"))
            ),
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_sidebar_media_question(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    """Sidebar media + 疑问/指示 utterance must not fall into the chat sink (R-PREC-02)."""
    if features.get("has_sidebar_media") and features.get("media_directed_question"):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="sidebar_media_question",
            confidence=0.71,
            precedence_rule_id="sidebar_media_question",
            clarify_question=ROUTE_CLARIFY_MEDIA,
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None


def _rule_empty(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    if not intent.utterance.strip():
        return _base_decision(
            ctx,
            flow_mode="canvas_agent",
            reason="empty_utterance",
            confidence=0.50,
            precedence_rule_id="empty",
            guard_veto=None,
            intent=intent,
            features=features,
        )
    return None


def _rule_default_chat(
    intent: AtomicIntent, features: RouteFeatures, ctx: RouteContext, valid_skill_ids: set[str] | None
) -> dict[str, Any] | None:
    return _base_decision(
        ctx,
        flow_mode="canvas_agent",
        reason="default_chat",
        confidence=0.80,
        precedence_rule_id="default_chat",
        guard_veto=_guard_veto(ctx),
        intent=intent,
        features=features,
    )


PRECEDENCE_RULES: list[tuple[str, RuleFn]] = [
    ("modify_existing_plan", _rule_modify_existing_plan),
    ("regen_no_checkpoint", _rule_regen_no_checkpoint),
    ("composition_confirm", _rule_composition_confirm),
    ("composition_structure", _rule_composition_structure),
    ("sidebar_img2img", _rule_sidebar_img2img),
    ("checkpoint_regen", _rule_checkpoint_regen),
    ("product_visual_explicit", _rule_product_visual_explicit),
    ("product_visual_intent", _rule_product_visual_intent),
    ("ref_backed_generate", _rule_ref_backed_generate),
    ("focus_gen", _rule_focus_gen),
    ("explicit_skill_orch", _rule_explicit_skill),
    ("orch_ambiguous", _rule_orch_ambiguous),
    # M4: explore noun/verb gate retired — canvas ops fall through to
    # canvas_agent (default_chat / empty) or decide_lane when primary=1.
    # Phase 2a: atomic_generate unregistered (see _rule_atomic_generate docstring).
    ("suspected_vision_clarify", _rule_suspected_vision_clarify),
    ("suspected_media_clarify", _rule_suspected_media_clarify),
    ("sidebar_media_question", _rule_sidebar_media_question),
    ("empty", _rule_empty),
    ("default_chat", _rule_default_chat),
]


def apply_route_precedence(
    intent: AtomicIntent,
    features: RouteFeatures,
    ctx: RouteContext,
    *,
    pending_clarify_reply: ClarifyReplyResult | None = None,
    valid_skill_ids: set[str] | None = None,
) -> dict[str, Any]:
    """First matching precedence rule wins (design §9.9)."""
    if pending_clarify_reply and pending_clarify_reply != "none":
        route = str(pending_clarify_reply.get("route") or "canvas_agent")
        # Phase 2d: non-campaign clarify resume never reopens atomic_create (incl. legacy route).
        flow = "campaign" if route == "campaign" else "canvas_agent"
        return _base_decision(
            ctx,
            flow_mode=flow,
            reason="clarify_resume",
            confidence=0.91,
            precedence_rule_id="clarify_resume",
            intent=intent,
            features=features,
        )

    for _rule_id, fn in PRECEDENCE_RULES:
        decision = fn(intent, features, ctx, valid_skill_ids)
        if decision is not None:
            return decision

    return _rule_default_chat(intent, features, ctx, valid_skill_ids)  # type: ignore[return-value]


def classify_pending_clarify_reply(
    original_utterance: str,
    clarify_question: str,
    user_reply: str,
    *,
    checkpoint: dict | None = None,
) -> ClarifyReplyResult:
    return classify_clarify_reply(
        original_utterance, clarify_question, user_reply, checkpoint=checkpoint
    )
