"""RouteContext assembly for platform L1 routing."""

from __future__ import annotations

from typing import Any, TypedDict

from app.graph.sidebar_attachments import normalize_mentioned_keys, resolve_sidebar_mentioned_keys


def latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


class RouteCheckpoint(TypedDict, total=False):
    atomic_node_id: str | None
    atomic_spec: dict | None
    user_brief: str | None
    plan_draft: str | None
    flow_mode_prev: str | None


class RouteContext(TypedDict, total=False):
    utterance: str
    mentioned_keys: list[str]
    sidebar_attachments: list[dict]
    focus_node_id: str | None
    requested_skill_id: str | None
    checkpoint: RouteCheckpoint


def assemble_route_context(state: dict[str, Any]) -> RouteContext:
    utterance = latest_user_text(state.get("messages") or [])
    mentioned = resolve_sidebar_mentioned_keys(state)
    attachments = list(state.get("sidebar_attachments") or [])
    focus = str(state.get("focus_node_id") or "").strip() or None
    requested = str(state.get("requested_skill_id") or "").strip() or None
    checkpoint: RouteCheckpoint = {
        "atomic_node_id": str(state.get("atomic_node_id") or "").strip() or None,
        "atomic_spec": state.get("atomic_spec") if isinstance(state.get("atomic_spec"), dict) else None,
        "user_brief": str(state.get("user_brief") or "").strip() or None,
        "plan_draft": str(state.get("plan_draft") or "").strip() or None,
        "flow_mode_prev": str(state.get("flow_mode") or "").strip() or None,
    }
    return {
        "utterance": utterance,
        "mentioned_keys": normalize_mentioned_keys(mentioned),
        "sidebar_attachments": attachments,
        "focus_node_id": focus,
        "requested_skill_id": requested,
        "checkpoint": checkpoint,
    }
