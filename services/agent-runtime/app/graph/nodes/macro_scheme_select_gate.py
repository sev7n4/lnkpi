"""Phase 2b macro scheme selection HITL (v1.1)."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

from app.graph.limits import MAX_SCHEME_REVISE
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.journey_trace import patch_macro_select_step
from app.graph.product_visual_v2.macro_select import (
    apply_macro_selection,
    default_macro_selection,
    validate_macro_selection,
)
from app.graph.product_visual_v2.presentation import (
    build_presentation_envelope,
    compute_expected_delivery,
)

MacroAction = Literal["none", "confirm", "revise"]

_MACRO_DECISION_PREFIX = "__macro_scheme_decision__"
_MACRO_REVISE_HINTS = (
    "但是",
    "需要",
    "增加",
    "改成",
    "改为",
    "希望",
    "补充",
    "更多",
    "调整",
    "修改",
    "不要",
    "换成",
    "减少",
    "去掉",
)
_NONE_TIP = "请勾选宏观方案（最多 2 套）后点「确认方案」，或说明要如何调整。"
_REVISE_ACK = "好的，正在根据你的反馈调整视觉方案…"
_CONFIRM_ACK = "已确认宏观方案，即将写入画布方案节点…"
_FORCE_SSOT_NOTE = f"修订次数已超限（{MAX_SCHEME_REVISE} 次），将按推荐方案继续。"


def build_macro_select_presentation_patch(
    state: dict,
    *,
    preview_selected_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Build presentation envelope + expected_delivery_count for macro HITL."""
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    schemes = state.get("macro_schemes") or []
    selected = (
        [str(s).strip() for s in preview_selected_ids if str(s).strip()]
        if preview_selected_ids is not None
        else [
            str(s).strip()
            for s in (state.get("selected_macro_scheme_ids") or default_macro_selection(schemes))
            if str(s).strip()
        ]
    )
    pres_state = {**state, "selected_macro_scheme_ids": selected}
    delivery = compute_expected_delivery(
        selected,
        state.get("shot_manifest") or [],
        copy=copy,
        state=state,
    )
    presentation = build_presentation_envelope(
        kind="macro_scheme_cards",
        phase="await_macro_scheme_select",
        state=pres_state,
        copy=copy,
    )
    return {
        "presentation": presentation,
        "expected_delivery_count": delivery["total_finalize"],
    }


def _await_macro_select_response(
    state: dict,
    *,
    preview_selected_ids: list[str] | None = None,
    messages: list[Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "phase": "await_macro_scheme_select",
        **build_macro_select_presentation_patch(state, preview_selected_ids=preview_selected_ids),
    }
    if messages is not None:
        out["messages"] = messages
    return out


def classify_macro_scheme_decision(
    text: str,
    *,
    user_decision: str | None = None,
) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith(_MACRO_DECISION_PREFIX):
        payload_raw = raw[len(_MACRO_DECISION_PREFIX) :].strip()
        try:
            parsed = json.loads(payload_raw)
            if isinstance(parsed, dict) and parsed.get("action") in ("confirm", "revise"):
                return parsed
        except json.JSONDecodeError:
            pass

    if user_decision == "confirm" or any(k in raw for k in ("确认方案", "确认宏观", "confirm_macro")):
        return {"action": "confirm"}
    if user_decision == "revise" or any(k in raw for k in ("调整方案", "修改方案", "revise")):
        feedback = re.sub(r"^(需要调整方案[：:]?|调整方案[：:]?)", "", raw).strip()
        return {"action": "revise", "feedback": feedback or raw}
    # Free-text revision at macro gate (e.g. "商业特写，但是需要增加更多模特展示图")
    if len(raw) > 12 and not any(k in raw for k in ("确认方案", "确认宏观", "confirm_macro")):
        if any(h in raw for h in _MACRO_REVISE_HINTS):
            return {"action": "revise", "feedback": raw}
    return {"action": "none"}


def apply_macro_scheme_decision(state: dict, decision: dict[str, Any]) -> dict[str, Any]:
    action = decision.get("action") or "none"
    schemes = state.get("macro_schemes") or []
    if not schemes:
        return {
            "phase": "error",
            "last_error": "macro_schemes_missing",
            "messages": [AIMessage(content="宏观方案缺失，请重新描述需求。")],
        }

    if action == "confirm":
        selected = decision.get("selected_ids")
        if not isinstance(selected, list):
            selected = default_macro_selection(schemes)
        err = validate_macro_selection([str(s) for s in selected])
        if err:
            preview = [str(s) for s in selected] if isinstance(selected, list) else None
            return _await_macro_select_response(
                state,
                preview_selected_ids=preview,
                messages=[AIMessage(content=err)],
            )
        try:
            applied = apply_macro_selection(schemes, [str(s) for s in selected])
        except ValueError as exc:
            preview = [str(s) for s in selected] if isinstance(selected, list) else None
            return _await_macro_select_response(
                state,
                preview_selected_ids=preview,
                messages=[AIMessage(content=str(exc))],
            )
        delivery = compute_expected_delivery(
            [str(s) for s in selected],
            state.get("shot_manifest") or [],
            copy=ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0"),
            state=state,
        )
        result = {
            **applied,
            "macro_scheme_decision": "confirm",
            "expected_delivery_count": delivery["total_finalize"],
            "messages": [AIMessage(content=_CONFIRM_ACK)],
        }
        result["journey_trace"] = patch_macro_select_step(
            state.get("journey_trace"),
            schemes=schemes,
            selected_ids=result.get("selected_macro_scheme_ids") or [],
        )
        return result

    if action == "revise":
        count = int(state.get("scheme_revision_count") or 0)
        if count >= MAX_SCHEME_REVISE:
            selected = default_macro_selection(schemes)
            applied = apply_macro_selection(schemes, selected)
            result = {
                **applied,
                "macro_scheme_decision": "auto",
                "assistant_note": _FORCE_SSOT_NOTE,
                "messages": [AIMessage(content=_FORCE_SSOT_NOTE)],
            }
            result["journey_trace"] = patch_macro_select_step(
                state.get("journey_trace"),
                schemes=schemes,
                selected_ids=result.get("selected_macro_scheme_ids") or [],
            )
            return result
        feedback = str(decision.get("feedback") or "").strip()
        out: dict[str, Any] = {
            "scheme_revision_count": count + 1,
            "phase": "dialog_draft",
            "macro_scheme_decision": "revise",
            "messages": [AIMessage(content=_REVISE_ACK)],
        }
        if feedback:
            out["macro_scheme_revision_feedback"] = feedback
        return out

    return _await_macro_select_response(state, messages=[AIMessage(content=_NONE_TIP)])


def route_after_await_macro_scheme_select(state: dict) -> str:
    phase = state.get("phase")
    if phase == "error":
        return "done"
    if phase == "dialog_draft":
        return "dialog_draft"
    if phase == "canvas_ssot_commit":
        return "canvas_ssot_commit"
    return "end"


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


def make_await_macro_scheme_select_node() -> Callable:
    async def await_macro_scheme_select(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return _await_macro_select_response(state)

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_macro_scheme_decision(text, user_decision=state.get("user_decision"))
        result = apply_macro_scheme_decision(state, decision)
        if decision.get("action") != "none":
            result["user_decision"] = "none"
        return result

    return await_macro_scheme_select
