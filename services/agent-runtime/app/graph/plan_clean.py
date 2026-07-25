"""Strip chitchat preamble before writing plan markdown to the canvas node."""

from __future__ import annotations

import re


_CHITCHAT_START = re.compile(
    r"^(好的|当然|我将|下面给|以下是|没问题|可以的)[，,。.\s]",
)


def strip_plan_preamble(md: str) -> str:
    text = (md or "").strip()
    if not text:
        return ""
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if re.match(r"^#\s+", ln.strip()):
            return "\n".join(lines[i:]).strip()
    # No heading: drop leading chitchat lines
    start = 0
    while start < len(lines) and (
        not lines[start].strip() or _CHITCHAT_START.match(lines[start].strip())
    ):
        start += 1
    return "\n".join(lines[start:]).strip() or text
