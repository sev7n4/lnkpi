"""Deferred tool search (meta harness) — token overlap over deferred catalog."""

from __future__ import annotations

import re
from typing import Any, Callable

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.tools.tool_plan import META_TOOL_NAME
from app.tools.tool_registry import DEFERRED_TOOL_NAMES, TOOL_EXPOSURES, ToolExposure

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)

# Human-readable snippets so queries like "image edit capabilities" match.
_DEFERRED_DESCRIPTIONS: dict[str, str] = {
    "get_image_edit_capabilities": (
        "image edit capabilities refine modes for a canvas node"
    ),
    "list_public_assets": "list public assets platform library",
    "introduce_nodes_to_agent": "introduce nodes to agent sidebar context",
}


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if t}


def match_deferred_tools(query: str, *, limit: int = 5) -> list[str]:
    """Rank deferred tools by token overlap on name + catalog description.

    Never returns GRAPH_ONLY names (search is deferred-only).
    """
    q_tokens = _tokens(query)
    if not q_tokens or limit <= 0:
        return []

    scored: list[tuple[int, str]] = []
    for name in sorted(DEFERRED_TOOL_NAMES):
        if TOOL_EXPOSURES.get(name) == ToolExposure.GRAPH_ONLY:
            continue
        desc = _DEFERRED_DESCRIPTIONS.get(name, name)
        hay = _tokens(name.replace("_", " ")) | _tokens(desc)
        score = len(q_tokens & hay)
        if score > 0:
            scored.append((score, name))

    scored.sort(key=lambda item: (-item[0], item[1]))
    return [name for _, name in scored[:limit]]


class ToolSearchInput(BaseModel):
    query: str = Field(description="Natural-language query to find deferred tools")
    limit: int = Field(default=5, description="Max deferred tools to load")


def make_tool_search_tool(*, on_loaded: Callable[[list[str]], None]) -> StructuredTool:
    """Build the meta `tool_search` StructuredTool with same-turn load callback."""

    def tool_search(query: str, limit: int = 5) -> dict[str, Any]:
        matched = match_deferred_tools(query, limit=limit)
        if matched:
            on_loaded(matched)
        candidates = [
            {
                "name": name,
                "score": 1.0,
                "description": _DEFERRED_DESCRIPTIONS.get(name, name),
            }
            for name in matched
        ]
        return {
            "loaded": matched,
            "candidates": candidates,
            "hint": None if matched else "No deferred tools matched; try different keywords.",
        }

    return StructuredTool.from_function(
        func=tool_search,
        name=META_TOOL_NAME,
        description=(
            "Search deferred canvas tools by keyword and load matches into this turn's "
            "visible tool set. Use when you need a tool that is not currently bound."
        ),
        args_schema=ToolSearchInput,
    )
