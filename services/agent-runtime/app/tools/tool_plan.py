from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from app.tools.tool_registry import DEFERRED_TOOL_NAMES, TOOL_EXPOSURES, ToolExposure

META_TOOL_NAME = "tool_search"


@dataclass(frozen=True)
class ToolPlan:
    visible_names: frozenset[str]
    ordered_visible: list[str]
    deferred_catalog: list[dict]


def build_tool_plan(*, loaded: Sequence[str] | None = None) -> ToolPlan:
    loaded_set = {n for n in (loaded or []) if n in DEFERRED_TOOL_NAMES}
    visible: set[str] = set()
    catalog: list[dict] = []
    for name, exp in TOOL_EXPOSURES.items():
        if exp == ToolExposure.GRAPH_ONLY:
            continue
        if exp == ToolExposure.DEFERRED:
            catalog.append({"name": name, "description": name, "tier": "deferred"})
            if name in loaded_set:
                visible.add(name)
            continue
        if exp in (ToolExposure.CORE, ToolExposure.META):
            visible.add(name)
    ordered = sorted(visible)
    return ToolPlan(frozenset(ordered), ordered, catalog)
