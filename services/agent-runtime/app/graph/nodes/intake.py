from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.atomic_intent import (
    atomic_regenerate_intent,
    is_regenerate_new_variant,
    orchestration_complexity_intent,
    regenerate_phrase_intent,
    resolve_intake_route,
)
from app.graph.intent import marketing_intent, modify_intent, single_node_gen_intent  # re-export for tests
from app.graph.l0_action import (
    TRANSFORM_VERBS,
    has_preserve_intent,
    utterance_has_multi_image_refs,
)
from app.graph.state import BRIEF_RESET_PREFIX
from app.skills.loader import discover_skills

REGENERATE_NO_CHECKPOINT_CLARIFY = (
    "当前对话还没有可重新生成的画布节点。"
    "请先在同一会话里完成首次创作（例如「帮我生成一张蓝牙耳机主图」），"
    "再说「重新生成一张」或「按刚才那个风格再生成一张」。"
)

ROUTE_CLARIFY_ORCHESTRATION = (
    "听起来像多节点编排或营销方案需求。请确认：\n"
    "1）单张/图生图原子出图；\n"
    "2）完整编排（请在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)


def latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _should_skip_atomic_campaign_override(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    img2img = utterance_has_multi_image_refs(t) and any(v in t for v in TRANSFORM_VERBS)
    return has_preserve_intent(t) or img2img


def make_intake_node(skills_dir: Path) -> Callable:
    async def intake(state: dict) -> dict:
        text = latest_user_text(state.get("messages") or [])
        entries = discover_skills(skills_dir)
        requested = str(state.get("requested_skill_id") or "").strip()
        by_id = {e.skill_id: e for e in entries}
        skill_id: str | None = None
        if requested and requested in by_id:
            skill_id = requested

        existing_brief = state.get("user_brief")
        existing_plan = state.get("plan_draft")
        focus_node_id = str(state.get("focus_node_id") or "").strip() or None
        route = resolve_intake_route(text, focus_node_id=focus_node_id)
        is_single_node = route == "single_node"
        is_atomic = route == "atomic_create"
        is_modify = bool(
            existing_brief and existing_plan and modify_intent(text) and not is_single_node
        )
        has_atomic_checkpoint = (
            bool(str(state.get("atomic_node_id") or "").strip())
            and isinstance(state.get("atomic_spec"), dict)
        )
        is_variant_create = has_atomic_checkpoint and is_regenerate_new_variant(text)
        needs_regen_clarify = not has_atomic_checkpoint and regenerate_phrase_intent(text)
        needs_route_clarify = False
        orch = orchestration_complexity_intent(text)
        if orch == "campaign" and (is_atomic or is_variant_create):
            if not _should_skip_atomic_campaign_override(text):
                is_atomic = False
                is_variant_create = False
                route = "campaign"

        flow_mode: str | None = None
        mode = "create"
        proposed_brief: str | None = None

        if is_single_node:
            proposed_brief = None
            flow_mode = "single_node"
        elif has_atomic_checkpoint and atomic_regenerate_intent(text):
            proposed_brief = None
            flow_mode = "atomic_regenerate"
            skill_id = None
        elif needs_regen_clarify:
            proposed_brief = None
            flow_mode = "atomic_create"
            skill_id = None
        elif is_modify:
            mode = "modify"
            proposed_brief = None  # reducer keeps existing brief
            flow_mode = "campaign"
        elif skill_id and (
            marketing_intent(text) or route == "campaign" or orch == "campaign"
        ):
            if existing_brief and not modify_intent(text):
                proposed_brief = BRIEF_RESET_PREFIX + text
            else:
                proposed_brief = text
            flow_mode = "campaign"
        elif is_atomic or is_variant_create:
            proposed_brief = None
            flow_mode = "atomic_create"
            skill_id = None
        elif marketing_intent(text) or (orch == "campaign" and route == "campaign"):
            if skill_id:
                if existing_brief and not modify_intent(text):
                    proposed_brief = BRIEF_RESET_PREFIX + text
                else:
                    proposed_brief = text
                flow_mode = "campaign"
            else:
                needs_route_clarify = True
                proposed_brief = None
                flow_mode = "chat"
        else:
            proposed_brief = None
            flow_mode = "chat"

        resolved_flow = (
            flow_mode
            if flow_mode in ("single_node", "atomic_create", "atomic_regenerate", "campaign")
            or needs_regen_clarify
            else "chat"
        )

        out: dict[str, Any] = {
            "phase": "intake",
            "skill_id": skill_id,
            "user_decision": "none",
            "split_manifest": state.get("split_manifest") or [],
            "last_error": state.get("last_error"),
            "mode": mode,
            "flow_mode": resolved_flow,
        }
        if resolved_flow in ("atomic_create", "atomic_regenerate"):
            out["split_manifest"] = []
            out["skill_id"] = None
        if needs_regen_clarify:
            out["phase"] = "clarify"
            out["clarify_question"] = REGENERATE_NO_CHECKPOINT_CLARIFY
        elif needs_route_clarify:
            out["phase"] = "clarify"
            out["clarify_question"] = ROUTE_CLARIFY_ORCHESTRATION
        if focus_node_id:
            out["focus_node_id"] = focus_node_id
        if proposed_brief is not None:
            out["user_brief"] = proposed_brief
        return out

    return intake
