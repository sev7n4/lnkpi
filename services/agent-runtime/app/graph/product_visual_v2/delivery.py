"""Phase 4 delivery helpers — shot_id grouping (spec v1.1)."""

from __future__ import annotations

from typing import Any


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


def variant_keys_for_shot(shot: dict[str, Any]) -> list[str]:
    shot_id = str(shot.get("shot_id") or "").strip()
    if not shot_id:
        return []
    variants = max(1, min(3, int(shot.get("variant_count") or 1)))
    if variants == 1:
        return [shot_id]
    return [f"{shot_id}__v{v}" for v in range(1, variants + 1)]


def ready_variant_keys(
    shot: dict[str, Any],
    gen_by_key: dict[str, dict],
    completed_keys: set[str] | None = None,
) -> list[str]:
    return [
        k
        for k in variant_keys_for_shot(shot)
        if _gen_key_ready(k, gen_by_key, completed_keys)
    ]


def build_delivery_selections_v2(
    shots: list[dict[str, Any]],
    gen_by_key: dict[str, dict] | None,
    completed_keys: set[str] | None = None,
) -> dict[str, str]:
    """Default first ready variant per shot (AC-P4-SHOT-DELIVERY)."""
    by_key = gen_by_key or {}
    selections: dict[str, str] = {}
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id") or "").strip()
        if not shot_id:
            continue
        ready = ready_variant_keys(shot, by_key, completed_keys)
        if ready:
            selections[shot_id] = ready[0]
    return selections


def validate_delivery_confirm_v2(
    shots: list[dict[str, Any]],
    selections: dict[str, str],
    gen_by_key: dict[str, dict],
    completed_keys: set[str] | None = None,
) -> tuple[bool, str]:
    if not shots:
        return False, "构图清单缺失，无法定稿。"
    missing: list[str] = []
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id") or "").strip()
        if not shot_id:
            continue
        variant_key = str(selections.get(shot_id) or "").strip()
        if not variant_key or not _gen_key_ready(variant_key, gen_by_key, completed_keys):
            label = str(shot.get("label") or shot_id)
            missing.append(label)
    if missing:
        labels = ", ".join(missing)
        return False, f"部分构图尚未生成成功，无法确认全部定稿。（未完成：{labels}）"
    return True, ""


def apply_delivery_decision_v2(state: dict, decision: dict[str, Any]) -> dict[str, Any]:
    from langchain_core.messages import AIMessage

    from app.graph.gen_run_state import clear_tier_b_gen_run_state, reset_tier_b_reducers_for_new_run

    action = decision.get("action") or "none"
    shots = [s for s in (state.get("shot_manifest") or []) if isinstance(s, dict)]
    if not shots:
        return {
            "phase": "error",
            "last_error": "shot_manifest_missing",
            "messages": [AIMessage(content="构图清单缺失，无法定稿。")],
        }

    current = dict(state.get("delivery_selections") or {})
    gen_by_key = dict(state.get("gen_by_key") or {})
    completed_keys = set(state.get("gen_completed_keys") or [])

    _SWITCH_ACK = "已切换定稿候选。"
    _CONFIRM_ACK = "已定稿全部视觉产出，感谢确认。"
    _REFINE_ACK = "好的，正在微调重绘该构图…"
    _NONE_TIP = "请切换各构图定稿图，或点「确认全部定稿」完成交付。"

    if action == "switch_scheme":
        shot_id = str(decision.get("type_id") or decision.get("shot_id") or "").strip()
        variant_key = str(decision.get("scheme_id") or decision.get("variant_key") or "").strip()
        if shot_id and variant_key and _gen_key_ready(variant_key, gen_by_key, completed_keys or None):
            current[shot_id] = variant_key
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
            for shot_id, variant_key in selections.items():
                sid = str(shot_id).strip()
                vk = str(variant_key).strip()
                if sid and vk:
                    merged[sid] = vk
            current = merged
        if not current:
            current = build_delivery_selections_v2(shots, gen_by_key, completed_keys or None)
        ok, err = validate_delivery_confirm_v2(shots, current, gen_by_key, completed_keys or None)
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
        shot_id = str(decision.get("type_id") or decision.get("shot_id") or "").strip()
        variant_key = str(
            decision.get("scheme_id")
            or decision.get("variant_key")
            or current.get(shot_id)
            or ""
        ).strip()
        if not shot_id or not variant_key:
            return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}
        item = _manifest_item_for_key(state, variant_key)
        if item is None:
            return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}
        feedback = str(decision.get("feedback") or "").strip()
        refined_item = dict(item)
        if feedback:
            hint = str(refined_item.get("prompt_hint") or "")
            refined_item["prompt_hint"] = f"{hint}\n用户微调：{feedback}".strip()
        manifest = list(state.get("split_manifest") or [])
        updated_manifest = [
            refined_item if isinstance(it, dict) and str(it.get("key") or "") == variant_key else it
            for it in manifest
        ]
        return {
            "split_manifest": updated_manifest,
            "gen_ordered_keys": [variant_key],
            "delivery_selections": current,
            "phase": "orchestrate_gen",
            "messages": [AIMessage(content=_REFINE_ACK)],
            **reset_tier_b_reducers_for_new_run(),
        }

    return {"phase": "await_delivery_confirm", "messages": [AIMessage(content=_NONE_TIP)]}


def build_delivery_summary_state(state: dict) -> dict[str, Any]:
    from langchain_core.messages import AIMessage

    shots = [s for s in (state.get("shot_manifest") or []) if isinstance(s, dict)]
    gen_by_key = dict(state.get("gen_by_key") or {})
    completed_keys = set(state.get("gen_completed_keys") or [])
    existing = state.get("delivery_selections")
    if isinstance(existing, dict) and existing:
        selections = {**existing}
        defaults = build_delivery_selections_v2(shots, gen_by_key, completed_keys or None)
        for shot_id, variant_key in defaults.items():
            selections.setdefault(shot_id, variant_key)
    else:
        selections = build_delivery_selections_v2(shots, gen_by_key, completed_keys or None)
    return {
        "delivery_selections": selections,
        "phase": "await_delivery_confirm",
        "messages": [
            AIMessage(
                content=(
                    "全部视觉候选已生成。请按构图切换定稿图，"
                    "如需微调可点「微调重绘」，确认后点「确认全部定稿」。"
                )
            )
        ],
    }


def _manifest_item_for_key(state: dict, key: str) -> dict[str, Any] | None:
    for item in state.get("split_manifest") or []:
        if isinstance(item, dict) and str(item.get("key") or "") == key:
            return item
    return None
