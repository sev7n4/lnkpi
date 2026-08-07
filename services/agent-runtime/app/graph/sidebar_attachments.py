from __future__ import annotations

import re

MAX_SIDEBAR_ATTACHMENTS = 5
MAX_MENTIONED_KEYS = 5

REF_PREFIX = {"text": "T", "image": "I", "video": "V", "audio": "A"}
_MENTIONED_KEY_RE = re.compile(r"^[TIVA]\d+$", re.IGNORECASE)
_MENTIONED_KEY_IN_TEXT_RE = re.compile(r"@([TIVA]\d+)", re.IGNORECASE)


def normalize_sidebar_attachments(raw: list[dict] | None) -> list[dict]:
    if not raw:
        return []
    if len(raw) > MAX_SIDEBAR_ATTACHMENTS:
        raise ValueError(f"最多 {MAX_SIDEBAR_ATTACHMENTS} 个参考素材")
    out: list[dict] = []
    for item in raw:
        url = str(item.get("url") or "").strip()
        text = str(item.get("text") or "").strip()
        if url.startswith("blob:"):
            raise ValueError("blob URL 不允许")
        if not url and not text:
            raise ValueError("参考素材缺少 url 或 text")
        out.append(dict(item))
    return out


def assign_sidebar_ref_keys(attachments: list[dict] | None) -> list[str]:
    """Assign T1/I1/V1/A1 keys in attachment order (matches useSidebarAttachments)."""
    if not attachments:
        return []
    counters = {k: 0 for k in REF_PREFIX}
    keys: list[str] = []
    for item in attachments:
        media_type = str(item.get("mediaType") or item.get("media_type") or "").strip()
        prefix = REF_PREFIX.get(media_type)
        if not prefix:
            continue
        counters[media_type] += 1
        keys.append(f"{prefix}{counters[media_type]}")
    return keys


def parse_mentioned_keys_from_text(text: str) -> list[str]:
    """Extract @I1-style keys from user message (matches web parseRefMentions)."""
    if not text:
        return []
    raw: list[str] = []
    for match in _MENTIONED_KEY_IN_TEXT_RE.finditer(text):
        raw.append(match.group(1))
    return normalize_mentioned_keys(raw)


def resolve_sidebar_mentioned_keys(state: dict) -> list[str]:
    """State keys first; fallback parse latest HumanMessage for @T1/@I1."""
    keys = normalize_mentioned_keys(state.get("sidebar_mentioned_keys"))
    if keys:
        return keys
    messages = state.get("messages") or []
    for msg in reversed(messages):
        content = getattr(msg, "content", None)
        if isinstance(content, str) and content.strip():
            parsed = parse_mentioned_keys_from_text(content)
            if parsed:
                return parsed
    return []


def normalize_mentioned_keys(raw: list[str] | None) -> list[str]:
    """Dedupe @-mention ref keys case-insensitively; uppercase (matches normalizeMentionedKeys)."""
    if not raw:
        return []
    if len(raw) > MAX_MENTIONED_KEYS:
        raise ValueError(f"最多 {MAX_MENTIONED_KEYS} 个 @ 提及")
    out: list[str] = []
    seen: set[str] = set()
    for key in raw:
        k = str(key or "").strip().upper()
        if not k or not _MENTIONED_KEY_RE.match(k):
            continue
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out
