"""Build Mermaid flowchart from split_manifest asset topology (not LangGraph control flow)."""

from __future__ import annotations

from typing import Any


def _safe_id(key: str) -> str:
    raw = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in (key or "n"))
    if not raw or raw[0].isdigit():
        raw = f"n_{raw}"
    return raw


def manifest_to_mermaid(manifest: list[Any]) -> str:
    """Return a mermaid flowchart LR from depends_on edges; labels use title (+ key)."""
    items = [x for x in (manifest or []) if isinstance(x, dict) and x.get("key")]
    if not items:
        return "```mermaid\nflowchart LR\n  empty[暂无节点]\n```"

    lines = ["```mermaid", "flowchart LR"]
    key_set = {str(it["key"]) for it in items}
    for it in items:
        key = str(it["key"])
        title = str(it.get("title") or key).replace('"', "'")
        nid = _safe_id(key)
        lines.append(f'  {nid}["{title} ({key})"]')
    for it in items:
        key = str(it["key"])
        nid = _safe_id(key)
        for dep in it.get("depends_on") or []:
            d = str(dep)
            if d not in key_set:
                continue
            lines.append(f"  {_safe_id(d)} --> {nid}")
    lines.append("```")
    return "\n".join(lines)
