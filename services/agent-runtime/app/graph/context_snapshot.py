"""W18: Context snapshot storage — brief/plan/manifest summaries outside checkpoint."""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

logger = logging.getLogger(__name__)

ContextStage = Literal["plan", "split"]


def manifest_summary_json(manifest: list[Any] | None) -> str | None:
    """Compact manifest summary for LLM context without full checkpoint payload."""
    items: list[dict[str, str]] = []
    for raw in manifest or []:
        if not isinstance(raw, dict) or not raw.get("key"):
            continue
        items.append(
            {
                "key": str(raw["key"]),
                "title": str(raw.get("title") or raw["key"]),
                "target_type": str(raw.get("target_type") or "image"),
            }
        )
    if not items:
        return None
    return json.dumps(items, ensure_ascii=False)


def build_snapshot_payload(
    state: dict,
    stage: ContextStage,
) -> dict[str, Any]:
    """Build save payload from graph state at a key node."""
    from app.graph.copy_sot import brief_from_messages

    brief = str(state.get("user_brief") or state.get("copy_sot_brief") or "").strip()
    if not brief:
        brief = brief_from_messages(list(state.get("messages") or []))

    plan_summary = str(state.get("plan_summary") or "").strip()
    if not plan_summary:
        plan_draft = str(state.get("plan_draft") or state.get("copy_sot_plan") or "").strip()
        plan_summary = plan_draft[:500] if plan_draft else ""

    manifest_json = manifest_summary_json(list(state.get("split_manifest") or []))
    message_count = len(state.get("messages") or [])

    return {
        "threadId": str(state.get("thread_id") or ""),
        "sessionId": str(state.get("session_id") or ""),
        "stage": stage,
        "brief": brief or None,
        "planSummary": plan_summary or None,
        "manifestJson": manifest_json,
        "messageCount": message_count,
    }


async def save_context_snapshot(nest: Any, payload: dict[str, Any]) -> str | None:
    """Persist snapshot via nest client; returns snapshot id or None on failure."""
    thread_id = str(payload.get("threadId") or "").strip()
    session_id = str(payload.get("sessionId") or "").strip()
    if not thread_id or not session_id:
        return None
    save = getattr(nest, "save_context_snapshot", None)
    if save is None:
        return None
    try:
        result = await save(
            thread_id=thread_id,
            session_id=session_id,
            stage=str(payload.get("stage") or "plan"),
            brief=payload.get("brief"),
            plan_summary=payload.get("planSummary"),
            manifest_json=payload.get("manifestJson"),
            message_count=payload.get("messageCount"),
        )
        return str(result.get("id") or "") or None
    except Exception as exc:  # noqa: BLE001 — snapshot is best-effort
        logger.warning("Failed to save context snapshot: %s", exc)
        return None


async def load_context_snapshot(
    nest: Any | None,
    thread_id: str,
    *,
    stage: ContextStage | None = None,
) -> dict[str, Any] | None:
    """Load latest snapshot for thread; optional stage filter prefers that stage."""
    if nest is None or not thread_id:
        return None
    get = getattr(nest, "get_context_snapshot", None)
    if get is None:
        return None
    try:
        return await get(thread_id=thread_id, stage=stage)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load context snapshot: %s", exc)
        return None


def brief_from_snapshot(snapshot: dict[str, Any] | None) -> str:
    if not snapshot:
        return ""
    return str(snapshot.get("brief") or "").strip()


def plan_summary_from_snapshot(snapshot: dict[str, Any] | None) -> str:
    if not snapshot:
        return ""
    return str(snapshot.get("planSummary") or "").strip()


def manifest_from_snapshot(snapshot: dict[str, Any] | None) -> list[dict[str, str]]:
    if not snapshot:
        return []
    raw = snapshot.get("manifestJson")
    if not raw:
        return []
    try:
        parsed = json.loads(str(raw))
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


async def persist_snapshot_from_state(
    nest: Any,
    state: dict,
    stage: ContextStage,
) -> dict[str, Any]:
    """Save snapshot and return state patch (context_snapshot_id)."""
    payload = build_snapshot_payload(state, stage)
    snap_id = await save_context_snapshot(nest, payload)
    if not snap_id:
        return {}
    return {"context_snapshot_id": snap_id}


async def resolve_brief_for_llm(state: dict, nest: Any | None = None) -> str:
    """Resolve user brief without scanning full message history when snapshot exists."""
    brief = str(state.get("user_brief") or state.get("copy_sot_brief") or "").strip()
    if brief:
        return brief
    thread_id = str(state.get("thread_id") or "").strip()
    if thread_id and nest is not None:
        snap = await load_context_snapshot(nest, thread_id, stage="plan")
        brief = brief_from_snapshot(snap)
        if brief:
            return brief
    from app.graph.copy_sot import brief_from_messages

    return brief_from_messages(list(state.get("messages") or []))
