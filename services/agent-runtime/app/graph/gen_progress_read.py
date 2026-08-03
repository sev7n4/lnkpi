"""Read generation outcomes from GenProgress (W15) for done-node summaries."""

from __future__ import annotations

import json
from typing import Any


def stats_from_progress_lines(lines: list[str]) -> tuple[int, int, int]:
    """Derive success / fail / fallback counts from formatted progress lines."""
    success_n = 0
    fail_n = 0
    fallback_n = 0
    for line in lines:
        if "出图成功" in line:
            success_n += 1
        elif "待确认平台兜底" in line:
            fallback_n += 1
        elif "失败" in line:
            fail_n += 1
    return success_n, fail_n, fallback_n


def parse_gen_progress_record(record: dict[str, Any]) -> tuple[list[str], int, int, int]:
    """Parse a get_gen_progress payload into lines and counts."""
    raw_lines = record.get("lines") or "[]"
    if isinstance(raw_lines, str):
        lines = json.loads(raw_lines)
    else:
        lines = list(raw_lines)
    success_n, fail_n, fallback_n = stats_from_progress_lines(lines)
    return lines, success_n, fail_n, fallback_n


async def load_gen_progress(nest: Any, thread_id: str) -> dict[str, Any] | None:
    """Fetch latest GenProgress row for thread_id via nest client."""
    if not nest or not thread_id:
        return None
    get_fn = getattr(nest, "get_gen_progress", None)
    if get_fn is None:
        return None
    try:
        return await get_fn(thread_id)
    except Exception:  # noqa: BLE001
        return None
