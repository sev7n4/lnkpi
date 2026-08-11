"""Effective utterance helpers for product_visual v2 (UX-PV-04)."""

from __future__ import annotations

import re
from typing import Any

_MACHINE_PREFIXES = (
    "__macro_scheme_decision__",
    "__scheme_decision__",
    "__delivery_decision__",
)

# Style terms commonly used in macro scheme selection utterances (thread pollution).
_STYLE_KEYWORD_TERMS = (
    "红金",
    "红金风",
    "牛皮纸",
    "极简",
    "国潮",
    "轻奢",
    "复古",
    "莫兰迪",
    "性冷淡",
    "新中式",
)


def is_machine_payload(text: str) -> bool:
    stripped = (text or "").strip()
    return any(stripped.startswith(prefix) for prefix in _MACHINE_PREFIXES)


def strip_machine_payload(text: str) -> str:
    """Remove machine decision lines/prefixes from user-visible utterance text."""
    if not text:
        return ""
    if is_machine_payload(text):
        return ""
    lines: list[str] = []
    for line in str(text).splitlines():
        stripped = line.strip()
        if any(stripped.startswith(prefix) for prefix in _MACHINE_PREFIXES):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def resolve_effective_utterance(text: str) -> str | None:
    """Return stripped user demand text, or None when message is machine-only / empty."""
    stripped = strip_machine_payload(text)
    return stripped or None


def extract_style_keywords(text: str) -> set[str]:
    found: set[str] = set()
    for term in _STYLE_KEYWORD_TERMS:
        if term in (text or ""):
            found.add(term)
    return found


def _prior_user_texts(state: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for msg in state.get("messages") or []:
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            stripped = strip_machine_payload(str(content))
            if stripped:
                texts.append(stripped)
    return texts


def collect_superseded_style_keywords(state: dict[str, Any]) -> set[str]:
    """Style terms from older thread utterances / intent not present in effective_utterance."""
    effective = str(state.get("effective_utterance") or "")
    effective_styles = extract_style_keywords(effective)
    superseded: set[str] = set()

    for text in _prior_user_texts(state):
        if text == effective:
            continue
        for kw in extract_style_keywords(text):
            if kw not in effective_styles and kw not in effective:
                superseded.add(kw)

    route_utt = str((state.get("route_context") or {}).get("utterance") or "")
    if route_utt and route_utt != effective:
        for kw in extract_style_keywords(route_utt):
            if kw not in effective_styles and kw not in effective:
                superseded.add(kw)

    intent = state.get("visual_intent") or {}
    for hint in intent.get("style_hints") or []:
        for kw in extract_style_keywords(str(hint)):
            if kw not in effective_styles and kw not in effective:
                superseded.add(kw)

    return superseded


def has_conflicting_style_utterance(state: dict[str, Any]) -> bool:
    return bool(collect_superseded_style_keywords(state))


def strip_superseded_style_keywords(text: str, superseded: set[str]) -> str:
    if not text or not superseded:
        return text
    result = text
    for kw in sorted(superseded, key=len, reverse=True):
        result = result.replace(kw, "")
    result = re.sub(r"[，、：:\s]+", " ", result)
    return result.strip(" ，、:：")
