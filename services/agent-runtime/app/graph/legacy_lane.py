"""Phase 2d.3 D4: runtime shim for retired lane / flow_mode literals.

Public ALLOWED / RouteFlowMode / state Literals must not include these strings.
Legacy inputs still map → canvas_agent until Phase 2d.4 removes the shim.
"""

from __future__ import annotations

LEGACY_LANE_SHIM = frozenset({"atomic_create", "atomic_regenerate", "single_node"})


def map_legacy_lane(lane: str | None) -> str | None:
    if lane in LEGACY_LANE_SHIM:
        return "canvas_agent"
    return lane
