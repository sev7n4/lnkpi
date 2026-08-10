"""Phase 2 product_visual scheme selection HITL gate (Task 4)."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

from app.graph.limits import MAX_SCHEME_REVISE

SchemeAction = Literal["none", "confirm_schemes", "revise"]

_SCHEME_DECISION_PREFIX = "__scheme_decision__"
_NONE_TIP = "请勾选各类型变体后点「确认所选变体」，或说明要如何调整方案。"
_REVISE_ACK = "好的，正在根据你的反馈调整视觉方案…"
_CONFIRM_ACK = "已确认变体选择，即将拆解画布任务…"
_FORCE_SPLIT_NOTE = (
    f"修订次数已超限（{MAX_SCHEME_REVISE} 次），将按推荐变体继续出图。"
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _last_role(messages: list[Any]) -> str | None:
    if not messages:
        return None
    last = messages[-1]
    return getattr(last, "type", None) or (last.get("role") if isinstance(last, dict) else None)


def default_scheme_selections(plan_dict: dict[str, Any]) -> dict[str, list[str]]:
    """Recommended scheme per type; single-scheme types always included."""
    selections: dict[str, list[str]] = {}
    for image_type in plan_dict.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        if not type_id or not schemes:
            continue
        recommended = [str(s["scheme_id"]) for s in schemes if s.get("recommended")]
        if len(schemes) == 1:
            selected = [str(schemes[0]["scheme_id"])]
        elif recommended:
            selected = recommended
        else:
            selected = [str(schemes[0]["scheme_id"])]
        selections[type_id] = selected
    return selections


def apply_selected_schemes(
    plan_dict: dict[str, Any],
    selections: dict[str, list[str]],
) -> dict[str, Any]:
    """Write selected_scheme_ids onto each image type (AC-6)."""
    merged = default_scheme_selections(plan_dict)
    for type_id, scheme_ids in selections.items():
        cleaned = [str(s).strip() for s in scheme_ids if str(s).strip()]
        if cleaned:
            merged[type_id] = cleaned

    updated_types: list[dict[str, Any]] = []
    for image_type in plan_dict.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        valid_ids = {str(s["scheme_id"]) for s in schemes}
        selected = [sid for sid in merged.get(type_id, []) if sid in valid_ids]
        if not selected and schemes:
            selected = default_scheme_selections({"image_types": [image_type]}).get(type_id, [])
        updated_types.append({**image_type, "selected_scheme_ids": selected})
    return {**plan_dict, "image_types": updated_types}


def prefill_recommended_schemes(plan_dict: dict[str, Any]) -> dict[str, Any]:
    """Force-select recommended (or first) scheme per type for revise limit (AC-9)."""
    selections = default_scheme_selections(plan_dict)
    return apply_selected_schemes(plan_dict, selections)


def classify_scheme_decision(
    text: str,
    *,
    user_decision: str | None = None,
) -> dict[str, Any]:
    """Classify user reply into scheme gate action."""
    raw = (text or "").strip()
    if raw.startswith(_SCHEME_DECISION_PREFIX):
        payload_raw = raw[len(_SCHEME_DECISION_PREFIX) :].strip()
        try:
            parsed = json.loads(payload_raw)
            if isinstance(parsed, dict) and parsed.get("action") in (
                "confirm_schemes",
                "revise",
            ):
                return parsed
        except json.JSONDecodeError:
            pass

    lowered = raw.lower()
    if user_decision == "confirm" or any(
        k in raw for k in ("确认所选变体", "确认变体", "确认所选", "confirm_schemes")
    ):
        return {"action": "confirm_schemes"}
    if user_decision == "revise" or any(
        k in raw for k in ("需要调整", "调整方案", "修改方案", "改一下", "revise")
    ):
        feedback = re.sub(r"^(需要调整方案[：:]?|调整方案[：:]?)", "", raw).strip()
        return {"action": "revise", "feedback": feedback or raw}

    return {"action": "none"}


def apply_scheme_decision(state: dict, decision: dict[str, Any]) -> dict[str, Any]:
    """Apply confirm / revise / force-split logic."""
    action = decision.get("action") or "none"
    plan = state.get("product_visual_plan")
    if not isinstance(plan, dict):
        return {
            "phase": "error",
            "last_error": "product_visual_plan_missing",
            "messages": [AIMessage(content="视觉方案缺失，请重新描述需求。")],
        }

    if action == "confirm_schemes":
        selections = decision.get("selections")
        if not isinstance(selections, dict):
            selections = default_scheme_selections(plan)
        updated_plan = apply_selected_schemes(plan, selections)
        return {
            "product_visual_plan": updated_plan,
            "phase": "split_product_visual",
            "messages": [AIMessage(content=_CONFIRM_ACK)],
        }

    if action == "revise":
        count = int(state.get("scheme_revision_count") or 0)
        if count >= MAX_SCHEME_REVISE:
            forced_plan = prefill_recommended_schemes(plan)
            return {
                "product_visual_plan": forced_plan,
                "phase": "split_product_visual",
                "assistant_note": _FORCE_SPLIT_NOTE,
                "messages": [AIMessage(content=_FORCE_SPLIT_NOTE)],
            }
        feedback = str(decision.get("feedback") or "").strip()
        out: dict[str, Any] = {
            "scheme_revision_count": count + 1,
            "phase": "plan_product_visual",
            "messages": [AIMessage(content=_REVISE_ACK)],
        }
        if feedback:
            out["scheme_revision_feedback"] = feedback
        return out

    return {"phase": "await_scheme_select", "messages": [AIMessage(content=_NONE_TIP)]}


def route_after_await_scheme_select(state: dict) -> str:
    phase = state.get("phase")
    if phase == "error":
        return "done"
    if phase == "plan_product_visual":
        return "plan_product_visual"
    if phase == "split_product_visual":
        return "split_product_visual_stub"
    return "end"


def make_await_scheme_select_node() -> Callable:
    async def await_scheme_select(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {"phase": "await_scheme_select"}

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_scheme_decision(text, user_decision=state.get("user_decision"))
        result = apply_scheme_decision(state, decision)
        if decision.get("action") != "none":
            result["user_decision"] = "none"
        return result

    return await_scheme_select
