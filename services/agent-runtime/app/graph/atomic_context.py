"""Phase 3: compact context for atomic parse (canvas + recent dialogue)."""

from __future__ import annotations

from typing import Any

from app.graph.atomic_parse_util import canvas_summary_nodes, format_canvas_context_line

_MAX_CONTEXT_CHARS = 500


def _message_role(msg: Any) -> str | None:
    role = getattr(msg, "type", None)
    if role:
        return str(role)
    if isinstance(msg, dict):
        return str(msg.get("role") or "")
    return None


def _message_content(msg: Any) -> str:
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict):
        content = msg.get("content")
    return str(content or "").strip()


def summarize_recent_turns(messages: list[Any] | None, *, max_turns: int = 2) -> str:
    """Compact summary of the last N user→assistant turns."""
    turns: list[str] = []
    pending_user: str | None = None
    for msg in messages or []:
        role = _message_role(msg)
        content = _message_content(msg)
        if not content:
            continue
        if role in ("human", "user"):
            pending_user = content[:80] + ("…" if len(content) > 80 else "")
        elif role in ("ai", "assistant") and pending_user:
            ai_short = content[:100].replace("\n", " ")
            if len(content) > 100:
                ai_short += "…"
            turns.append(f"用户:{pending_user}→助手:{ai_short}")
            pending_user = None
    if not turns:
        return ""
    return "；".join(turns[-max_turns:])


def build_atomic_parse_context(
    state: dict[str, Any],
    *,
    canvas_summary: dict[str, Any] | None = None,
    max_chars: int = _MAX_CONTEXT_CHARS,
) -> str:
    """Canvas one-liner + last 2 dialogue turns for hybrid parse."""
    parts: list[str] = []
    nodes = canvas_summary_nodes(canvas_summary)
    canvas_line = format_canvas_context_line(nodes)
    if canvas_line:
        parts.append(canvas_line)
    history = summarize_recent_turns(state.get("messages") or [])
    if history:
        parts.append(f"近期对话:{history}")
    if not parts:
        return ""
    ctx = " | ".join(parts)
    if len(ctx) <= max_chars:
        return ctx
    return ctx[: max_chars - 1] + "…"
