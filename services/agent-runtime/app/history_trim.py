"""W17: Conversation history trimming with token budget and anchor preservation."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Rough mixed CJK/Latin estimate (~4 chars per token).
_CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _message_content(msg: Any) -> str:
    content = getattr(msg, "content", None) or (
        msg.get("content") if isinstance(msg, dict) else ""
    )
    return str(content or "")


def _message_role(msg: Any) -> str | None:
    role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
    if role in ("human", "user"):
        return "user"
    if role in ("ai", "assistant"):
        return "assistant"
    return None


def _looks_like_plan_draft(content: str) -> bool:
    t = content.strip()
    if not t:
        return False
    markers = ("方案", "确认", "1 / A", "1. 采纳", "请选择", "【已确认方案")
    if any(m in t for m in markers):
        return True
    return t.startswith("#") or t.startswith("|")


def _protected_indices(messages: list[Any]) -> set[int]:
    """Keep first user turn and first plan-like assistant reply (user_brief/plan_draft anchors)."""
    protected: set[int] = set()
    for i, msg in enumerate(messages):
        role = _message_role(msg)
        content = _message_content(msg)
        if role == "user" and content.strip():
            protected.add(i)
            break
    for i, msg in enumerate(messages):
        if i in protected:
            continue
        if _message_role(msg) == "assistant" and _looks_like_plan_draft(_message_content(msg)):
            protected.add(i)
            break
    return protected


def trim_history(
    messages: list[Any],
    *,
    window: int,
    token_budget: int | None = None,
    preserve_anchors: bool = True,
) -> list[Any]:
    """Trim to recent window, optionally capped by token budget.

    When ``preserve_anchors`` is True, the first substantive user message and the
    first plan-like assistant reply are always kept even if they fall outside the
    recent window (user_brief / plan_draft context in chat history).
    """
    if not messages:
        return []

    protected = _protected_indices(messages) if preserve_anchors else set()

    if len(messages) <= window and token_budget is None:
        return messages

    selected: set[int] = set(protected)

    # Fill from most recent backward until window or token budget is reached.
    recent: list[int] = []
    tokens = sum(estimate_tokens(_message_content(messages[i])) for i in protected)
    for i in range(len(messages) - 1, -1, -1):
        if i in selected:
            continue
        if len(selected) >= window:
            break
        msg_tokens = estimate_tokens(_message_content(messages[i]))
        if token_budget is not None and tokens + msg_tokens > token_budget:
            if recent:
                break
            # Always keep at least one recent message when over budget.
            recent.append(i)
            selected.add(i)
            tokens += msg_tokens
            break
        recent.append(i)
        selected.add(i)
        tokens += msg_tokens

    if len(selected) < len(messages):
        dropped = len(messages) - len(selected)
        logger.info(
            "W17 history trim: kept %d/%d messages (window=%d token_budget=%s dropped=%d)",
            len(selected),
            len(messages),
            window,
            token_budget,
            dropped,
        )

    return [messages[i] for i in sorted(selected)]
