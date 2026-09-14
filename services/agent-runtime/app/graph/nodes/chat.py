"""Retired zero-tool chat path (M2a).

Default / empty / greeting lanes now emit ``canvas_agent`` and the builder maps
``chat`` | ``explore_canvas`` | ``canvas_agent`` → the tool-bearing ``explore``
node. This module is kept only so historical imports do not break; do not re-add
a zero-tool chat graph edge.

System prompt lives on explore (spec §3.6); re-exported here for legacy tests.
Sidebar parse is injected on explore's SystemMessage (HumanMessage stays
latest user text; no image_url). R-UX-03 prefixes the first AIMessage there.
"""

from __future__ import annotations

from typing import Any, Callable

from app.graph.nodes.explore import _EXPLORE_SYSTEM as _SYSTEM  # noqa: F401


def make_chat_node(*, llm: Any) -> Callable:
    """Unused — graph no longer registers a chat node (M2a)."""

    async def chat(state: dict) -> dict:
        raise RuntimeError(
            "zero-tool chat node is retired; route canvas_agent/chat/explore_canvas → explore"
        )

    return chat
