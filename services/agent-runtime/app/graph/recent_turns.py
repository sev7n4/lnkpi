"""Compress recent conversation turns for canvas_agent / decide_lane (D7)."""

from __future__ import annotations

import json
from typing import Any


def _msg_role(msg: Any) -> str:
    role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
    return str(role or "")


def _msg_content(msg: Any) -> str:
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict):
        content = msg.get("content")
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    try:
        return json.dumps(content, ensure_ascii=False, default=str)
    except Exception:
        return str(content).strip()


def _tool_calls(msg: Any) -> list[dict[str, Any]]:
    raw = getattr(msg, "tool_calls", None)
    if raw is None and isinstance(msg, dict):
        raw = msg.get("tool_calls")
    if not raw:
        return []
    out: list[dict[str, Any]] = []
    for tc in raw:
        if isinstance(tc, dict):
            out.append(tc)
        else:
            out.append(
                {
                    "name": getattr(tc, "name", "") or "",
                    "args": getattr(tc, "args", {}) or {},
                    "id": getattr(tc, "id", "") or "",
                }
            )
    return out


def _summarize_tool_result(content: str, *, limit: int = 120) -> str:
    text = (content or "").strip()
    if not text:
        return ""
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def compress_recent_turns(messages: list, *, max_turns: int = 4) -> str:
    """Compress recent Human/AI/Tool messages into a short multi-turn summary.

    Includes prior user text, assistant snippets, and tool names + result
    summaries so follow-ups like「再导一次」can see ``export_media_package``.
    """
    if not messages or max_turns <= 0:
        return ""

    turns: list[list[Any]] = []
    current: list[Any] = []
    for msg in messages:
        role = _msg_role(msg)
        if role in ("human", "user"):
            if current:
                turns.append(current)
            current = [msg]
        else:
            if not current:
                current = [msg]
            else:
                current.append(msg)
    if current:
        turns.append(current)

    selected = turns[-max_turns:]
    lines: list[str] = []
    for turn in selected:
        for msg in turn:
            role = _msg_role(msg)
            content = _msg_content(msg)
            if role in ("human", "user"):
                if content:
                    lines.append(f"用户: {content}")
                continue
            if role in ("ai", "assistant"):
                calls = _tool_calls(msg)
                names = [str(c.get("name") or "") for c in calls if c.get("name")]
                if names:
                    lines.append(f"助手工具: {', '.join(names)}")
                if content:
                    snippet = content if len(content) <= 160 else content[:159] + "…"
                    lines.append(f"助手: {snippet}")
                continue
            if role == "tool":
                summary = _summarize_tool_result(content)
                if summary:
                    lines.append(f"工具结果: {summary}")
    return "\n".join(lines)
