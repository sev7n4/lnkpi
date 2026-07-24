"""Topological sort for auto-generate image/video keys in a split manifest."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any, Iterable


def topo_sort_gen_keys(
    manifest: Iterable[dict[str, Any]],
    *,
    types: tuple[str, ...] = ("image", "video"),
) -> list[str]:
    """Return keys for auto_generate items of given types in dependency order.

    Only edges among those keys are considered. Raises ValueError on cycles.
    """
    allowed = set(types)
    items = [
        item
        for item in manifest
        if item.get("target_type") in allowed and bool(item.get("auto_generate"))
    ]
    keys = {str(item["key"]) for item in items if item.get("key")}
    indegree: dict[str, int] = {k: 0 for k in keys}
    dependents: dict[str, list[str]] = defaultdict(list)

    for item in items:
        key = str(item["key"])
        for dep in item.get("depends_on") or []:
            dep_key = str(dep)
            if dep_key not in keys:
                continue
            dependents[dep_key].append(key)
            indegree[key] += 1

    ready = deque(sorted(k for k, d in indegree.items() if d == 0))
    ordered: list[str] = []
    while ready:
        node = ready.popleft()
        ordered.append(node)
        for child in sorted(dependents[node]):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)
        if len(ready) > 1:
            ready = deque(sorted(ready))

    if len(ordered) != len(keys):
        raise ValueError("cycle detected in depends_on graph")
    return ordered


def topo_sort_image_keys(manifest: Iterable[dict[str, Any]]) -> list[str]:
    """Backward-compatible: image-only auto_generate keys."""
    return topo_sort_gen_keys(manifest, types=("image",))
