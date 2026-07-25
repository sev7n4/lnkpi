"""Trim canvas-manifest items to a key subset with dependency closure."""

from __future__ import annotations

from typing import Any


def dependency_closure(items: list[dict[str, Any]], selected: set[str]) -> set[str]:
    by_key = {str(it["key"]): it for it in items if it.get("key")}
    out = set(selected) & set(by_key)
    changed = True
    while changed:
        changed = False
        for key in list(out):
            deps = by_key.get(key, {}).get("depends_on") or []
            for d in deps:
                ds = str(d)
                if ds in by_key and ds not in out:
                    out.add(ds)
                    changed = True
    return out


def trim_manifest_items(
    items: list[dict[str, Any]],
    selected_keys: list[str] | set[str],
) -> list[dict[str, Any]]:
    """Keep only selected keys plus depends_on closure; preserve original order."""
    wanted = dependency_closure(list(items), {str(k) for k in selected_keys})
    return [it for it in items if str(it.get("key") or "") in wanted]
