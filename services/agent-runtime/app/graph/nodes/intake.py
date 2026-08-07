from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.intent import marketing_intent, modify_intent, single_node_gen_intent
from app.graph.atomic_clarify import is_affirmative_clarify_reply, pending_atomic_clarify
from app.graph.route_context import assemble_route_context, latest_user_text
from app.graph.route_decide import ROUTE_CLARIFY_ORCHESTRATION, decide_route
from app.graph.state import BRIEF_RESET_PREFIX
from app.skills.loader import discover_skills

REGENERATE_NO_CHECKPOINT_CLARIFY = (
    "当前对话还没有可重新生成的画布节点（可能上一轮尚未成功完成）。"
    "请先在同一会话里完成首次创作，或点击历史消息中的引用芯片重新加入 @I1 @I2 后再试；"
    "也可以说「重新生成一张」或「按刚才那个风格再生成一张」。"
)


def make_intake_node(skills_dir: Path) -> Callable:
    async def intake(state: dict) -> dict:
        entries = discover_skills(skills_dir)
        by_id = {e.skill_id: e for e in entries}
        ctx = assemble_route_context(state)
        decision = decide_route(ctx, valid_skill_ids=set(by_id.keys()))

        requested = str(ctx.get("requested_skill_id") or "").strip()
        skill_id: str | None = requested if requested in by_id else None
        flow_mode = decision["flow_mode"]
        mode = "modify" if decision.get("is_modify") else "create"
        proposed_brief: str | None = None
        needs_regen_clarify = decision.get("reason") == "regen_no_checkpoint"
        needs_route_clarify = flow_mode == "clarify_route" and not needs_regen_clarify

        text = str(ctx.get("utterance") or "")
        existing_brief = (ctx.get("checkpoint") or {}).get("user_brief")

        if flow_mode == "campaign" and skill_id and mode == "create":
            if existing_brief and not modify_intent(text):
                proposed_brief = BRIEF_RESET_PREFIX + text
            else:
                proposed_brief = text
        elif flow_mode in ("atomic_create", "atomic_regenerate", "single_node"):
            skill_id = None

        if skill_id is None and flow_mode == "campaign":
            prev_skill = str(state.get("skill_id") or "").strip()
            if prev_skill and prev_skill in by_id:
                skill_id = prev_skill

        resolved_flow = flow_mode if flow_mode != "clarify_route" else "chat"

        pending_clarify = pending_atomic_clarify(state)
        if pending_clarify and is_affirmative_clarify_reply(text):
            flow_mode = "atomic_create"
            resolved_flow = "atomic_create"
            skill_id = None

        out: dict[str, Any] = {
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
        }
        if resolved_flow in ("atomic_create", "atomic_regenerate"):
            out["split_manifest"] = []
            out["skill_id"] = None
        if pending_clarify and is_affirmative_clarify_reply(text):
            out["clarify_question"] = None
        if needs_regen_clarify:
            out["phase"] = "clarify"
            out["clarify_question"] = REGENERATE_NO_CHECKPOINT_CLARIFY
        elif needs_route_clarify:
            out["phase"] = "clarify"
            out["route_clarify"] = True
            out["clarify_question"] = decision.get("clarify_question") or ROUTE_CLARIFY_ORCHESTRATION
        focus_node_id = ctx.get("focus_node_id")
        if focus_node_id:
            out["focus_node_id"] = focus_node_id
        if proposed_brief is not None:
            out["user_brief"] = proposed_brief
        return out

    return intake
