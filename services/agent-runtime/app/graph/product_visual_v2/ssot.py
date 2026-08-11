"""Canvas SSOT prose builder (spec R-Canvas-SSOT, §1.4)."""

from __future__ import annotations

import json
import re
from typing import Any

PROSE_MIN_LENGTH = 200


def prose_min_length() -> int:
    return PROSE_MIN_LENGTH


def is_prose_content(content: str, *, min_length: int = PROSE_MIN_LENGTH) -> bool:
    text = str(content or "").strip()
    if len(text) < min_length:
        return False
    if _looks_like_json_plan(text):
        return False
    return True


def build_ssot_prose(
    *,
    sections: dict[str, str],
    merge_mode: str = "parallel",
) -> str:
    """
    Build SSOT node content from per-macro prose sections.

    merge_mode:
      - parallel: ## 方案 A / ## 方案 B headers (default)
      - merged: single doc with merged title marker
    """
    if not sections:
        raise ValueError("sections must not be empty")
    if merge_mode == "merged":
        body = "\n\n".join(sections.values()).strip()
        return f"# 融合方案 (merged)\n\n{body}"
    parts: list[str] = []
    for scheme_id, body in sections.items():
        header = f"## 方案 {scheme_id}"
        parts.append(f"{header}\n\n{body.strip()}")
    return "\n\n".join(parts)


def ssot_section_keys(content: str) -> list[str]:
    return re.findall(r"^##\s*方案\s+(\S+)\s*$", content, flags=re.MULTILINE)


def _looks_like_json_plan(text: str) -> bool:
    if not text.startswith("{"):
        return False
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict) and "image_types" in parsed
