"""Journey trace snapshot builder for product_visual v2 sidebar UX."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.graph.product_visual_v2.macro_select import should_skip_macro_hitl
from app.graph.product_visual_v2.scheme_draft import normalize_macro_schemes

JOURNEY_STEP_ORDER: list[str] = [
    "image_qa",
    "scheme_draft",
    "macro_select",
    "ssot_persist",
    "shot_plan",
    "topo_preview",
    "generating",
    "delivery",
    "done",
]

JOURNEY_STEP_LABELS: dict[str, str] = {
    "image_qa": "检查产品图",
    "scheme_draft": "理解需求 · 出方案",
    "macro_select": "选宏观风格",
    "ssot_persist": "方案落盘",
    "shot_plan": "定构图清单",
    "topo_preview": "预览出图计划",
    "generating": "出图中",
    "delivery": "选定稿",
    "done": "交付完成",
}

_COMPLETED_STATUSES = frozenset({"done", "skipped", "failed"})
_PRESERVE_FIELDS = ("enteredAt", "completedAt", "ms", "summary", "snapshot")

_ERROR_TO_FAILED_STEP: dict[str, str] = {
    "decompose_shots_parse_failed": "shot_plan",
    "plan_node_id_missing": "shot_plan",
    "upsert_unavailable": "shot_plan",
    "shot_manifest_missing": "shot_plan",
    "orchestrate_empty": "generating",
    "product_visual_plan_missing": "scheme_draft",
    "dialog_draft_parse_failed": "scheme_draft",
    "macro_schemes_missing": "macro_select",
}


def _utc_now(now: datetime | None) -> datetime:
    if now is not None:
        return now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ms_between(start: datetime, end: datetime) -> int:
    return max(0, int((end - start).total_seconds() * 1000))


def _completed_step_ids(current: str) -> list[str]:
    if current not in JOURNEY_STEP_ORDER:
        return []
    idx = JOURNEY_STEP_ORDER.index(current)
    return JOURNEY_STEP_ORDER[:idx]


def _macro_select_labels(state: dict[str, Any]) -> list[str]:
    schemes = state.get("macro_schemes") or []
    id_to_label = {
        str(s.get("id") or ""): str(s.get("label") or s.get("id") or "").strip()
        for s in schemes
        if isinstance(s, dict) and str(s.get("id") or "").strip()
    }
    selected = [
        str(s).strip()
        for s in (state.get("selected_macro_scheme_ids") or [])
        if str(s).strip()
    ]
    return [id_to_label.get(sid, sid) for sid in selected]


def _macro_select_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    schemes = state.get("macro_schemes") or []
    selected = [
        str(s).strip()
        for s in (state.get("selected_macro_scheme_ids") or [])
        if str(s).strip()
    ]
    return {
        "kind": "macro_select",
        "schemes": normalize_macro_schemes(schemes if isinstance(schemes, list) else []),
        "selectedIds": selected,
    }


def _enrich_macro_select(step: dict[str, Any], state: dict[str, Any]) -> None:
    if should_skip_macro_hitl(state.get("macro_schemes")):
        step["status"] = "skipped"
        step["summary"] = "仅一套方案，已自动选定"
        return
    labels = _macro_select_labels(state)
    if labels:
        step["summary"] = f"已选：{'、'.join(labels)}"
        step["snapshot"] = _macro_select_snapshot(state)


def _failed_step_for_state(state: dict[str, Any], *, phase: str, current: str) -> str | None:
    last_error = str(state.get("last_error") or "").strip()
    if last_error:
        mapped = _ERROR_TO_FAILED_STEP.get(last_error)
        if mapped:
            return mapped
    if phase == "error":
        return current if current in JOURNEY_STEP_ORDER else "scheme_draft"
    if phase == "done" and last_error:
        return "shot_plan"
    return None


def _step_status(
    step_id: str,
    *,
    current: str,
    completed: list[str],
    phase: str,
    state: dict[str, Any],
) -> str:
    failed_at = _failed_step_for_state(state, phase=phase, current=current)
    if failed_at and failed_at in JOURNEY_STEP_ORDER:
        failed_idx = JOURNEY_STEP_ORDER.index(failed_at)
        step_idx = JOURNEY_STEP_ORDER.index(step_id)
        if step_idx < failed_idx:
            return "done"
        if step_idx == failed_idx:
            return "failed"
        return "pending"

    if phase == "done":
        return "done"
    if step_id in completed:
        return "done"
    if step_id == current:
        return "running"
    return "pending"


def build_journey_trace_snapshot(
    state: dict[str, Any],
    *,
    phase: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build a fresh journey trace snapshot from runtime state and phase."""
    from app.graph.product_visual_v2.presentation import phase_to_stepper

    ts = _utc_now(now)
    current = phase_to_stepper(phase)
    completed = _completed_step_ids(current)
    failed_at = _failed_step_for_state(state, phase=phase, current=current)
    started_at = _iso(ts)

    steps: list[dict[str, Any]] = []
    for step_id in JOURNEY_STEP_ORDER:
        status = _step_status(
            step_id,
            current=current,
            completed=completed,
            phase=phase,
            state=state,
        )
        step: dict[str, Any] = {
            "id": step_id,
            "label": JOURNEY_STEP_LABELS[step_id],
            "status": status,
        }
        if status == "running":
            step["enteredAt"] = _iso(ts)
        elif status in _COMPLETED_STATUSES or status == "done":
            step["enteredAt"] = _iso(ts)
            step["completedAt"] = _iso(ts)
            step["ms"] = 0
        if step_id == "macro_select" and (
            step_id in completed or (failed_at and step_id in JOURNEY_STEP_ORDER[: JOURNEY_STEP_ORDER.index(failed_at)])
        ):
            if phase == "done" and not state.get("last_error"):
                if should_skip_macro_hitl(state.get("macro_schemes")):
                    step["summary"] = "仅一套方案，已自动选定"
                else:
                    labels = _macro_select_labels(state)
                    if labels:
                        step["summary"] = f"已选：{'、'.join(labels)}"
                        step["snapshot"] = _macro_select_snapshot(state)
            else:
                _enrich_macro_select(step, state)
        steps.append(step)

    snapshot: dict[str, Any] = {
        "version": 1,
        "flowMode": "product_visual",
        "steps": steps,
        "current": current,
        "startedAt": started_at,
        "updatedAt": _iso(ts),
    }

    if phase == "done":
        snapshot["finishedAt"] = _iso(ts)
        snapshot["totalMs"] = 0

    return snapshot


def patch_macro_select_step(
    prev: dict[str, Any] | None,
    *,
    schemes: list[Any],
    selected_ids: list[str],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Patch macro_select step after confirm/auto without rebuilding the full trace."""
    ts = _utc_now(now)
    state = {
        "macro_schemes": schemes,
        "selected_macro_scheme_ids": selected_ids,
    }

    if not isinstance(prev, dict) or prev.get("flowMode") != "product_visual":
        prev = build_journey_trace_snapshot(state, phase="canvas_ssot_commit", now=ts)

    trace: dict[str, Any] = {
        **prev,
        "steps": [{**s} if isinstance(s, dict) else s for s in (prev.get("steps") or [])],
        "updatedAt": _iso(ts),
        "current": "ssot_persist",
    }

    for i, step in enumerate(trace["steps"]):
        if not isinstance(step, dict) or step.get("id") != "macro_select":
            continue
        patched: dict[str, Any] = {**step}
        if should_skip_macro_hitl(schemes):
            patched["status"] = "skipped"
            patched["summary"] = "仅一套方案，已自动选定"
            patched.pop("snapshot", None)
        else:
            patched["status"] = "done"
            labels = _macro_select_labels(state)
            if labels:
                patched["summary"] = f"已选：{'、'.join(labels)}"
                patched["snapshot"] = _macro_select_snapshot(state)
        if patched.get("completedAt") is None:
            patched["completedAt"] = _iso(ts)
        if patched.get("enteredAt") is None:
            patched["enteredAt"] = _iso(ts)
        if patched.get("ms") is None:
            try:
                entered = datetime.fromisoformat(str(patched["enteredAt"]).replace("Z", "+00:00"))
                patched["ms"] = _ms_between(entered, ts)
            except ValueError:
                patched["ms"] = 0
        trace["steps"][i] = patched
        break

    return trace


def merge_journey_trace(
    prev: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    phase: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Merge a new snapshot with a previous one, preserving completed step history."""
    ts = _utc_now(now)
    snapshot = build_journey_trace_snapshot(state, phase=phase, now=ts)

    if isinstance(prev, dict) and prev.get("flowMode") == "product_visual":
        if prev.get("startedAt"):
            snapshot["startedAt"] = prev["startedAt"]
        prev_steps = {
            str(s.get("id") or ""): s
            for s in (prev.get("steps") or [])
            if isinstance(s, dict) and str(s.get("id") or "").strip()
        }
        for step in snapshot["steps"]:
            step_id = str(step.get("id") or "")
            prev_step = prev_steps.get(step_id)
            if not isinstance(prev_step, dict):
                continue
            if prev_step.get("status") not in _COMPLETED_STATUSES:
                continue
            if step.get("status") not in _COMPLETED_STATUSES and step.get("status") != "done":
                continue
            for field in _PRESERVE_FIELDS:
                if prev_step.get(field) is not None:
                    step[field] = prev_step[field]

    if phase == "done" and snapshot.get("startedAt"):
        try:
            started = datetime.fromisoformat(str(snapshot["startedAt"]).replace("Z", "+00:00"))
            snapshot["totalMs"] = _ms_between(started, ts)
        except ValueError:
            snapshot["totalMs"] = 0

    return snapshot
