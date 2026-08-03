"""Tier B generation run state (W3 / P0-03).

LangGraph Send fan-out requires reducer-backed fields on the graph schema.
These fields are **transient**: they must only be populated between ``start_gen``
and ``collect_gen``, and must never leak into the next run on the same thread.

See ADR-001 §4.2: Tier B is excluded from the Tier A ≤18 field budget.
"""

from __future__ import annotations

from typing import Any

# Set at split (W13), survives await_topo interrupt — Tier A, not cleared here.
GEN_ORDER_FIELD = "gen_ordered_keys"

# Active only during a single generation run (start_gen → collect_gen).
TIER_B_GEN_RUN_FIELDS: tuple[str, ...] = (
    "gen_deps_of",
    "gen_by_key",
    "gen_completed_keys",
    "gen_failed_keys",
    "gen_needs_user_keys",
    "gen_fail_details",
)

# Reducer-backed accumulators reset at the start of each run.
TIER_B_REDUCER_FIELDS: tuple[str, ...] = (
    "gen_completed_keys",
    "gen_failed_keys",
    "gen_needs_user_keys",
    "gen_fail_details",
)


def clear_tier_b_gen_run_state() -> dict[str, None]:
    """Return state delta that clears all Tier B gen-run fields."""
    return {field: None for field in TIER_B_GEN_RUN_FIELDS}


def reset_tier_b_reducers_for_new_run() -> dict[str, None]:
    """Return state delta that resets reducer accumulators for a fresh gen run."""
    return {field: None for field in TIER_B_REDUCER_FIELDS}


def tier_b_fields_active(state: dict[str, Any]) -> list[str]:
    """Return names of Tier B fields currently non-empty (for tests/diagnostics)."""
    active: list[str] = []
    for field in TIER_B_GEN_RUN_FIELDS:
        val = state.get(field)
        if val:
            active.append(field)
    return active
