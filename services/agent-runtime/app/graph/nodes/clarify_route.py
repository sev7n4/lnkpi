"""Route-level clarify — thin wrapper over unified clarify_gate."""

from __future__ import annotations

from typing import Callable

from app.graph.nodes.clarify_gate import make_clarify_gate_node


def make_clarify_route_node() -> Callable:
    gate = make_clarify_gate_node()

    async def clarify_route(state: dict) -> dict:
        return await gate({**state, "route_clarify": True})

    return clarify_route
