from __future__ import annotations

from typing import Any


def canvas_nodes_from_state(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Optional canvas snapshot on gen_node state; never fetch from Nest here."""
    for raw in (state.get("canvas_nodes"), state.get("nodes")):
        if isinstance(raw, list):
            return [n for n in raw if isinstance(n, dict)]
    canvas = state.get("canvas")
    if isinstance(canvas, list):
        return [n for n in canvas if isinstance(n, dict)]
    if isinstance(canvas, dict):
        inner = canvas.get("nodes")
        if isinstance(inner, list):
            return [n for n in inner if isinstance(n, dict)]
    return []


def hydrate_gen_by_key_from_canvas(nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build gen_by_key items from canvas node recipe identity (compile/import)."""
    id_to_recipe_key = _canvas_id_to_recipe_key(nodes)
    by_key: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data")
        if not isinstance(data, dict):
            data = {}
        raw_key = data.get("recipeKey")
        if not raw_key:
            continue
        key = str(raw_key)
        nid = node.get("id")
        item: dict[str, Any] = {
            "key": key,
            "node_id": str(nid) if nid else None,
            "chain": data.get("chain"),
            "role": data.get("role"),
            "title": data.get("title") or node.get("title") or key,
        }
        mentioned = data.get("mentionedKeys")
        if _is_key_list(mentioned):
            item["depends_on"] = [id_to_recipe_key.get(str(k), str(k)) for k in mentioned]
        gen_mode = data.get("genMode")
        if gen_mode:
            item["gen_mode"] = gen_mode
        by_key[key] = item
    return by_key


def merge_hydrated_by_key(
    *,
    key: str,
    by_key: dict[str, dict[str, Any]],
    hydrated: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Overlay: existing keys win; fill missing node_id / identity on the current key."""
    merged = {**hydrated, **by_key}
    current = merged.get(key)
    base = hydrated.get(key)
    if current and not current.get("node_id") and base:
        merged[key] = _fill_missing_identity(base, current)
    elif not current and base:
        merged[key] = dict(base)
    return merged


def _fill_missing_identity(hydrated_item: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    out = {**hydrated_item, **item}
    if not out.get("node_id"):
        out["node_id"] = hydrated_item.get("node_id")
    for field in ("chain", "role", "title", "depends_on", "gen_mode"):
        if not out.get(field) and hydrated_item.get(field):
            out[field] = hydrated_item[field]
    return out


def _canvas_id_to_recipe_key(nodes: list[dict[str, Any]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        nid = node.get("id")
        raw_key = data.get("recipeKey") if isinstance(data, dict) else None
        if nid and raw_key:
            mapping[str(nid)] = str(raw_key)
    return mapping


def _is_key_list(value: Any) -> bool:
    """Compile writes canvas node ids into mentionedKeys; older graphs may still store recipe keys."""
    return isinstance(value, list) and all(isinstance(x, str) for x in value)
