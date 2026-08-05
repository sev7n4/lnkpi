"""Phase 3: compact context for atomic parse — delegates to ContextPacket."""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.graph.context_packet import build_parse_packet, explore_summary_from_packet
from app.graph.context_render import render_packet_for_llm

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
    """Compact summary of the last N user→assistant turns (legacy helper / tests)."""
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
    """Structured markdown context for parse LLM (replaces pipe-delimited string)."""
    packet = build_parse_packet(state, canvas_summary=canvas_summary)
    rendered = render_packet_for_llm(packet)
    if len(rendered) <= max_chars:
        return rendered
    return rendered[: max_chars - 1] + "…"


def build_atomic_parse_packet(
    state: dict[str, Any],
    *,
    canvas_summary: dict[str, Any] | None = None,
) -> Any:
    return build_parse_packet(state, canvas_summary=canvas_summary)
