from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.clarify_context import pending_clarify
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.intent import modify_intent, single_node_gen_intent
from app.graph.atomic_clarify import is_affirmative_clarify_reply, pending_atomic_clarify
from app.graph.route_context import assemble_route_context, latest_user_text
from app.graph.route_decide import ROUTE_CLARIFY_ORCHESTRATION, decide_route
from app.graph.route_trace import serialize_route_decision
from app.graph.context_packet import should_include_prior_task
from app.graph.product_visual_v2.utterance import extract_user_request_labels, resolve_effective_utterance
from app.graph.state import BRIEF_RESET_PREFIX
from app.skills.loader import discover_skills

REGENERATE_NO_CHECKPOINT_CLARIFY = (
    "当前对话还没有可重新生成的画布节点（可能上一轮尚未成功完成）。"
    "请先在同一会话里完成首次创作，或点击历史消息中的引用芯片重新加入 @I1 @I2 后再试；"
    "也可以说「重新生成一张」或「按刚才那个风格再生成一张」。"
)

ROUTE_CLARIFY_UNKNOWN = "未能识别您的选择，请回复 1 / 2 / 3。"

SKILL_REQUIRED_CLARIFY = (
    "完整编排需要先在侧栏选用已安装的 Skill，再发送需求或回复 2。"
)


def make_intake_node(skills_dir: Path, *, llm: Any = None) -> Callable:
    async def intake(state: dict) -> dict:
        entries = discover_skills(skills_dir)
        by_id = {e.skill_id: e for e in entries}
        text = latest_user_text(state.get("messages") or [])

        pending = pending_clarify(state)
        if pending and pending.get("kind") == "route_orchestration":
            original = str(pending.get("original_utterance") or "")
            question = str(pending.get("clarify_question") or state.get("clarify_question") or "")
            classified = classify_clarify_reply(original, question, text)
            if classified != "none":
                route = str(classified.get("route") or "")
                if route == "campaign":
                    requested = str(state.get("requested_skill_id") or "").strip()
                    skill_id = requested if requested in by_id else None
                    if not skill_id:
                        prev = str(state.get("skill_id") or "").strip()
                        skill_id = prev if prev in by_id else None
                    if skill_id:
                        return {
                            "phase": "intake",
                            "skill_id": skill_id,
                            "flow_mode": "campaign",
                            "mode": "create",
                            "user_decision": "none",
                            "clarify_context": None,
                            "clarify_question": None,
                            "route_clarify": False,
                            "user_brief": original or text,
                            "previous_lane": "campaign",
                        }
                    return {
                        "phase": "clarify",
                        "flow_mode": "chat",
                        "skill_id": None,
                        "clarify_question": SKILL_REQUIRED_CLARIFY,
                        "route_clarify": True,
                        "clarify_context": pending,
                    }
                if route in ("atomic_create", "canvas_agent"):
                    # Phase 2d: clarify single-image / vision-text → canvas_agent (legacy atomic_create mapped).
                    out: dict[str, Any] = {
                        "phase": "intake",
                        "skill_id": None,
                        "flow_mode": "canvas_agent",
                        "mode": "create",
                        "user_decision": "none",
                        "clarify_context": None,
                        "clarify_question": None,
                        "route_clarify": False,
                        "pre_parsed_intent": classified,
                        "split_manifest": [],
                        "previous_lane": "canvas_agent",
                    }
                    mk = list(pending.get("mentioned_keys") or [])
                    if mk:
                        out["sidebar_mentioned_keys"] = mk
                    return out
            return {
                "phase": "clarify",
                "flow_mode": "chat",
                "skill_id": None,
                "clarify_question": ROUTE_CLARIFY_UNKNOWN,
                "route_clarify": True,
                "clarify_context": pending,
            }

        ctx = assemble_route_context(state)
        decision = serialize_route_decision(
            decide_route(
                ctx,
                valid_skill_ids=set(by_id.keys()),
                llm=llm,
                messages=state.get("messages"),
                previous_lane=state.get("previous_lane") or state.get("flow_mode"),
            )
        )

        requested = str(ctx.get("requested_skill_id") or "").strip()
        skill_id: str | None = requested if requested in by_id else None
        flow_mode = decision["flow_mode"]
        # Phase 2d.2: never write live atomic_create / atomic_regenerate / single_node.
        if flow_mode in ("atomic_create", "atomic_regenerate", "single_node"):
            skill_id = None
            flow_mode = "canvas_agent"
            decision = {**decision, "flow_mode": "canvas_agent"}
        mode = "modify" if decision.get("is_modify") else "create"
        proposed_brief: str | None = None
        needs_regen_clarify = decision.get("reason") == "regen_no_checkpoint"
        needs_route_clarify = flow_mode == "clarify_route" and not needs_regen_clarify

        text = str(ctx.get("utterance") or "")
        existing_brief = (ctx.get("checkpoint") or {}).get("user_brief")

        if flow_mode == "product_visual" and not skill_id and "ecommerce-product-visual" in by_id:
            skill_id = "ecommerce-product-visual"

        if flow_mode in ("campaign", "product_visual") and skill_id and mode == "create":
            if existing_brief and not modify_intent(text):
                proposed_brief = BRIEF_RESET_PREFIX + text
            else:
                proposed_brief = text

        if skill_id is None and flow_mode == "campaign":
            prev_skill = str(state.get("skill_id") or "").strip()
            if prev_skill and prev_skill in by_id:
                skill_id = prev_skill

        # Campaign / product_visual without a resolvable skill must clarify —
        # never fall through builder to explore with a silent skill-less campaign.
        skill_required_missing = (
            skill_id is None
            and flow_mode in ("campaign", "product_visual")
            and not needs_regen_clarify
            and not needs_route_clarify
        )
        if skill_required_missing:
            flow_mode = "clarify_route"
            needs_route_clarify = True
            decision = {
                **decision,
                "flow_mode": "clarify_route",
                "reason": "skill_required_without_skill",
                "clarify_question": SKILL_REQUIRED_CLARIFY,
            }

        resolved_flow = flow_mode if flow_mode != "clarify_route" else "chat"

        pending_atomic = pending_atomic_clarify(state)
        if (
            pending_atomic
            and pending_atomic.get("kind") != "route_orchestration"
            and is_affirmative_clarify_reply(text)
        ):
            # Phase 2d: affirmative atomic-style clarify → canvas_agent (not atomic_create).
            flow_mode = "canvas_agent"
            resolved_flow = "canvas_agent"
            skill_id = None

        out = {
            "phase": "intake",
            "skill_id": skill_id,
            "user_decision": "none",
            "split_manifest": state.get("split_manifest") or [],
            "last_error": state.get("last_error"),
            "mode": mode,
            "flow_mode": resolved_flow,
            "route_context": ctx,
            "route_decision": decision,
            "route_clarify": False,
            # Persist decided lane for multi-turn decide_lane (D7).
            "previous_lane": decision.get("flow_mode") or resolved_flow,
        }
        if resolved_flow in ("atomic_create", "atomic_regenerate"):
            out["split_manifest"] = []
            out["skill_id"] = None
        elif resolved_flow == "canvas_agent":
            # Phase 2d: former atomic single-create isolation — clear campaign residue
            # when utterance still looks like single-node media create.
            from app.graph.atomic_intent import utterance_suggests_atomic_create

            if utterance_suggests_atomic_create(text):
                out["split_manifest"] = []
                out["skill_id"] = None
        if (
            pending_atomic
            and pending_atomic.get("kind") != "route_orchestration"
            and is_affirmative_clarify_reply(text)
        ):
            out["clarify_question"] = None
            out["clarify_context"] = None
        if needs_regen_clarify:
            out["phase"] = "clarify"
            out["clarify_question"] = REGENERATE_NO_CHECKPOINT_CLARIFY
        elif needs_route_clarify:
            out["phase"] = "clarify"
            out["route_clarify"] = True
            out["clarify_question"] = decision.get("clarify_question") or ROUTE_CLARIFY_ORCHESTRATION
            out["thinking_summary"] = "待确认：单张出图还是完整编排"
        focus_node_id = ctx.get("focus_node_id")
        if focus_node_id:
            out["focus_node_id"] = focus_node_id
        if proposed_brief is not None:
            out["user_brief"] = proposed_brief
        if resolved_flow == "product_visual":
            effective = resolve_effective_utterance(text)
            if effective:
                out["effective_utterance"] = effective
                labels = extract_user_request_labels(effective)
                if labels:
                    out["user_request_labels"] = labels
        prior_spec = state.get("atomic_spec") if isinstance(state.get("atomic_spec"), dict) else None
        if (
            resolved_flow == "atomic_create"
            and prior_spec
            and not should_include_prior_task(text, prior_spec)
        ):
            out["atomic_spec"] = None
            out["atomic_node_id"] = None
            out["atomic_items"] = None
            out["atomic_record_id"] = None
        return out

    return intake
