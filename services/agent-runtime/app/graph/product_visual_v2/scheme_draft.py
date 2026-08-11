"""Scheme draft prose section helpers (UX-PV-05)."""

from __future__ import annotations

SCHEME_DRAFT_HEADINGS: tuple[str, ...] = (
    "## 我理解您的需求",
    "## 设计方向摘要",
    "## 完整方案说明",
    "## 接下来请您",
)

MAX_MACRO_SUMMARY_CHARS = 80


def scheme_draft_has_four_sections(prose: str) -> bool:
    """Return True when draft_prose contains all four required Markdown headings."""
    text = str(prose or "")
    return all(heading in text for heading in SCHEME_DRAFT_HEADINGS)


def normalize_macro_scheme_card(scheme: dict) -> dict:
    """Normalize macro scheme fields for macro_scheme_cards presentation."""
    summary = str(scheme.get("summary") or "").strip()
    if len(summary) > MAX_MACRO_SUMMARY_CHARS:
        summary = summary[: MAX_MACRO_SUMMARY_CHARS - 1].rstrip() + "…"

    raw_tags = scheme.get("tags") or []
    tags: list[str] = []
    if isinstance(raw_tags, list):
        for tag in raw_tags:
            cleaned = str(tag or "").strip().lstrip("#")
            if cleaned and cleaned not in tags:
                tags.append(cleaned)

    return {
        "id": str(scheme.get("id") or "").strip(),
        "label": str(scheme.get("label") or "").strip(),
        "summary": summary,
        "tags": tags[:5],
        "recommended": bool(scheme.get("recommended")),
        "recommend_reason": str(scheme.get("recommend_reason") or "").strip() or None,
    }


def normalize_macro_schemes(schemes: list[dict]) -> list[dict]:
    return [normalize_macro_scheme_card(s) for s in schemes if isinstance(s, dict)]
