"""Phase C: reconcile split_manifest from live canvas before generation."""

from __future__ import annotations

from typing import Any

_GEN_TARGET_TYPES = frozenset({"image", "video"})


def reconcile_manifest_from_canvas(
    manifest: list[dict[str, Any]],
    canvas_nodes: list[dict[str, Any]],
    *,
    plan_node_id: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Return (updated_manifest, note). Canvas is authoritative for node presence."""
    plan_id = (plan_node_id or "").strip()
    canvas_by_id = {
        str(n.get("id") or ""): n for n in canvas_nodes if isinstance(n, dict) and n.get("id")
    }

    updated: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    notes: list[str] = []

    for item in manifest:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("node_id") or "").strip()
        if node_id:
            canvas_node = canvas_by_id.get(node_id)
            if canvas_node is None:
                notes.append(f"移除「{item.get('title') or item.get('key')}」（画布已删）")
                continue
            merged = dict(item)
            merged["title"] = str(canvas_node.get("title") or merged.get("title") or merged.get("key"))
            updated.append(merged)
            seen_ids.add(node_id)
        else:
            updated.append(dict(item))

    existing_keys = {str(it.get("key")) for it in updated if it.get("key")}
    for node_id, canvas_node in canvas_by_id.items():
        if node_id in seen_ids or node_id == plan_id:
            continue
        node_type = str(canvas_node.get("type") or "")
        if node_type not in _GEN_TARGET_TYPES:
            continue
        key = _canvas_key_for_node(node_id, existing_keys)
        existing_keys.add(key)
        updated.append(
            {
                "key": key,
                "title": str(canvas_node.get("title") or key),
                "target_type": node_type,
                "node_id": node_id,
                "depends_on": [],
                "auto_generate": True,
            }
        )
        notes.append(f"纳入「{canvas_node.get('title') or key}」")

    note = "画布已同步：" + ("；".join(notes) if notes else "无结构变化")
    return updated, note


def _canvas_key_for_node(node_id: str, existing_keys: set[str]) -> str:
    suffix = node_id.replace("-", "_")[-16:]
    base = f"canvas_{suffix}" if suffix else "canvas_node"
    if base not in existing_keys:
        return base
    idx = 2
    while f"{base}_{idx}" in existing_keys:
        idx += 1
    return f"{base}_{idx}"
