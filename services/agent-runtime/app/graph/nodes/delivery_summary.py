"""Phase 4 product_visual delivery summary + HITL confirm gate (Task 7)."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.gen_run_state import clear_tier_b_gen_run_state, reset_tier_b_reducers_for_new_run

_DELIVERY_DECISION_PREFIX = "__delivery_decision__"
_NONE_TIP = "请切换各类型定稿图，或点「确认全部定稿」完成交付。"
_CONFIRM_ACK = "已定稿全部视觉产出，感谢确认。"
_REFINE_ACK = "好的，正在微调重绘该类型…"
_SWITCH_ACK = "已切换定稿候选。"
_INCOMPLETE_DELIVERY_TIP = (
    "部分类型尚未生成成功，无法确认全部定稿。请重试出图、切换候选，或等待生成完成。"
)


def _plan_type_ids(plan: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        if type_id:
            ids.append(type_id)
    return ids


def _gen_key_ready(
    key: str,
    gen_by_key: dict[str, dict],
    completed_keys: set[str] | None,
) -> bool:
    entry = gen_by_key.get(key) or {}
    url = entry.get("url")
    if not isinstance(url, str) or not url.strip():
        return False
    if completed_keys and key not in completed_keys:
        return False
    return True


def validate_delivery_confirm(
    plan: dict[str, Any],
    selections: dict[str, str],
    gen_by_key: dict[str, dict],
    completed_keys: set[str] | None = None,
) -> tuple[bool, str]:
    """AC-8: every plan type must have a successful gen with url before confirm."""
    type_ids = _plan_type_ids(plan)
    if not type_ids:
        return False, "视觉方案无交付类型。"
    missing: list[str] = []
    for type_id in type_ids:
        scheme_id = str(selections.get(type_id) or "").strip()
        if not scheme_id:
            missing.append(type_id)
            continue
        key = _scheme_key(type_id, scheme_id)
        if not _gen_key_ready(key, gen_by_key, completed_keys):
            missing.append(type_id)
    if missing:
        labels = ", ".join(missing)
        return False, f"{_INCOMPLETE_DELIVERY_TIP}（未完成：{labels}）"
    return True, ""


def _scheme_key(type_id: str, scheme_id: str) -> str:
    return f"{type_id}__{scheme_id}"


def _candidate_scheme_ids(
    image_type: dict[str, Any],
    gen_by_key: dict[str, dict],
    completed_keys: set[str] | None = None,
) -> list[str]:
    type_id = str(image_type.get("type_id") or "").strip()
    schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
    selected = [str(s) for s in (image_type.get("selected_scheme_ids") or []) if str(s).strip()]
    ids: list[str] = []
    for sid in selected:
        key = _scheme_key(type_id, sid)
        if key in gen_by_key and _gen_key_ready(key, gen_by_key, completed_keys):
            ids.append(sid)
    if not ids:
        for scheme in schemes:
            sid = str(scheme.get("scheme_id") or "").strip()
            key = _scheme_key(type_id, sid)
            if sid and key in gen_by_key and _gen_key_ready(key, gen_by_key, completed_keys):
                ids.append(sid)
    if not ids:
        ids = selected or [str(s.get("scheme_id") or "").strip() for s in schemes if s.get("scheme_id")]
    return [sid for sid in ids if sid]


def build_delivery_selections(
    plan: dict[str, Any],
    gen_by_key: dict[str, dict] | None,
    completed_keys: set[str] | None = None,
) -> dict[str, str]:
    """Default recommended scheme per type (AC-7)."""
    by_key = gen_by_key or {}
    selections: dict[str, str] = {}
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        if not type_id:
            continue
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        candidate_ids = _candidate_scheme_ids(image_type, by_key, completed_keys)
        if not candidate_ids:
            continue
        recommended = [str(s["scheme_id"]) for s in schemes if s.get("recommended")]
        pick = next((sid for sid in recommended if sid in candidate_ids), None)
        if pick is None:
            pick = candidate_ids[0]
        selections[type_id] = pick
    return selections


def classify_delivery_decision(
    text: str,
    *,
    user_decision: str | None = None,
) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith(_DELIVERY_DECISION_PREFIX):
        payload_raw = raw[len(_DELIVERY_DECISION_PREFIX) :].strip()
        try:
            parsed = json.loads(payload_raw)
            if isinstance(parsed, dict) and parsed.get("action") in (
                "confirm_delivery",
                "switch_scheme",
                "refine_type",
            ):
                return parsed
        except json.JSONDecodeError:
            pass

    if user_decision == "confirm" or any(
        k in raw for k in ("确认全部定稿", "确认定稿", "confirm_delivery")
    ):
        return {"action": "confirm_delivery"}
    if user_decision == "revise" or any(k in raw for k in ("微调重绘", "微调", "refine_type")):
        feedback = re.sub(r"^(微调重绘[：:]?|微调[：:]?)", "", raw).strip()
        return {"action": "refine_type", "feedback": feedback or raw}
    return {"action": "none"}


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


def _manifest_item_for_key(state: dict, key: str) -> dict[str, Any] | None:
    for item in state.get("split_manifest") or []:
        if isinstance(item, dict) and str(item.get("key") or "") == key:
            return item
    return None


def apply_delivery_decision(state: dict, decision: dict[str, Any]) -> dict[str, Any]:
    action = decision.get("action") or "none"
    plan = state.get("product_visual_plan")
    if not isinstance(plan, dict):
        return {
            "phase": "error",
            "last_error": "product_visual_plan_missing",
            "messages": [AIMessage(content="视觉方案缺失，无法定稿。")],
        }

    current = dict(state.get("delivery_selections") or {})
    gen_by_key = dict(state.get("gen_by_key") or {})
    completed_keys = set(state.get("gen_completed_keys") or [])

    if action == "switch_scheme":
        type_id = str(decision.get("type_id") or "").strip()
        scheme_id = str(decision.get("scheme_id") or "").strip()
        key = _scheme_key(type_id, scheme_id)
        if type_id and scheme_id and _gen_key_ready(key, gen_by_key, completed_keys or None):
            current[type_id] = scheme_id
            return {
                "delivery_selections": current,
                "phase": "await_delivery_confirm",
                "messages": [AIMessage(content=_SWITCH_ACK)],
            }
        return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}

    if action == "confirm_delivery":
        selections = decision.get("selections")
        if isinstance(selections, dict):
            merged = {**current}
            for type_id, scheme_id in selections.items():
                tid = str(type_id).strip()
                sid = str(scheme_id).strip()
                if tid and sid:
                    merged[tid] = sid
            current = merged
        if not current:
            current = build_delivery_selections(plan, gen_by_key, completed_keys or None)
        ok, err = validate_delivery_confirm(
            plan, current, gen_by_key, completed_keys or None
        )
        if not ok:
            return {
                "phase": "await_delivery_confirm",
                "delivery_selections": current,
                "messages": [AIMessage(content=err)],
            }
        return {
            "delivery_selections": current,
            "phase": "done",
            "messages": [AIMessage(content=_CONFIRM_ACK)],
            **clear_tier_b_gen_run_state(),
        }

    if action == "refine_type":
        type_id = str(decision.get("type_id") or "").strip()
        scheme_id = str(decision.get("scheme_id") or current.get(type_id) or "").strip()
        if not type_id or not scheme_id:
            return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}
        key = _scheme_key(type_id, scheme_id)
        item = _manifest_item_for_key(state, key)
        if item is None:
            return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}
        feedback = str(decision.get("feedback") or "").strip()
        refined_item = dict(item)
        if feedback:
            hint = str(refined_item.get("prompt_hint") or "")
            refined_item["prompt_hint"] = f"{hint}\n用户微调：{feedback}".strip()
        manifest = list(state.get("split_manifest") or [])
        updated_manifest = [
            refined_item if isinstance(it, dict) and str(it.get("key") or "") == key else it
            for it in manifest
        ]
        return {
            "split_manifest": updated_manifest,
            "gen_ordered_keys": [key],
            "delivery_selections": current,
            "phase": "orchestrate_gen",
            "messages": [AIMessage(content=_REFINE_ACK)],
            **reset_tier_b_reducers_for_new_run(),
        }

    return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}


def route_after_collect_gen(state: dict) -> str:
    if state.get("flow_mode") == "product_visual":
        return "delivery_summary"
    return "done"


def route_after_delivery_summary(state: dict) -> str:
    if state.get("phase") == "error":
        return "done"
    if state.get("phase") == "await_delivery_confirm":
        return "await_delivery_confirm"
    return "end"


def route_after_await_delivery_confirm(state: dict) -> str:
    phase = state.get("phase")
    if phase == "error":
        return "done"
    if phase == "done":
        return "done"
    if phase == "orchestrate_gen":
        return "start_gen"
    return "end"


def make_delivery_summary_node() -> Callable:
    async def delivery_summary(state: dict) -> dict:
        plan = state.get("product_visual_plan")
        if not isinstance(plan, dict):
            return {
                "phase": "error",
                "last_error": "product_visual_plan_missing",
                "messages": [AIMessage(content="视觉方案缺失，无法汇总定稿。")],
            }
        gen_by_key = dict(state.get("gen_by_key") or {})
        completed_keys = set(state.get("gen_completed_keys") or [])
        existing = state.get("delivery_selections")
        if isinstance(existing, dict) and existing:
            selections = {**existing}
            defaults = build_delivery_selections(plan, gen_by_key, completed_keys or None)
            for type_id, scheme_id in defaults.items():
                selections.setdefault(type_id, scheme_id)
        else:
            selections = build_delivery_selections(plan, gen_by_key, completed_keys or None)
        return {
            "delivery_selections": selections,
            "phase": "await_delivery_confirm",
            "messages": [
                AIMessage(
                    content=(
                        "全部视觉候选已生成。请按类型切换定稿图，"
                        "如需微调可点「微调重绘」，确认后点「确认全部定稿」。"
                    )
                )
            ],
        }

    return delivery_summary


def make_await_delivery_confirm_node() -> Callable:
    async def await_delivery_confirm(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {"phase": "await_delivery_confirm"}

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_delivery_decision(text, user_decision=state.get("user_decision"))
        result = apply_delivery_decision(state, decision)
        if decision.get("action") != "none":
            result["user_decision"] = "none"
        return result

    return await_delivery_confirm
