"""Extract client-side canvas commands from Harness tool results."""

from __future__ import annotations

from typing import Any


def extract_canvas_commands(result: Any) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    raw = result.get("canvasCommands") or result.get("canvas_commands")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict) and item.get("type"):
            out.append(item)
    return out
