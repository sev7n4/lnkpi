"""Downstream limits and shot_id validation (spec §1.5, §4.1)."""

from __future__ import annotations

import re

MIN_MACRO_SCHEMES_GENERATED = 1
MAX_MACRO_SCHEMES_GENERATED = 4
MAX_MACRO_SCHEMES_SELECTED = 4
MAX_SHOTS_PER_MACRO_SCHEME = 8
MAX_DOWNSTREAM = 12

_SHOT_ID_RE = re.compile(r"^[a-z0-9_]+__\d+$")


def is_valid_shot_id(shot_id: str) -> bool:
    return bool(_SHOT_ID_RE.match(str(shot_id or "").strip()))


def count_downstream(
    *,
    phase1_seed_count: int = 0,
    shots: list[dict] | None = None,
) -> int:
    """Phase1 seeds + sum(shot.variant_count)."""
    total = max(0, phase1_seed_count)
    for shot in shots or []:
        if not isinstance(shot, dict):
            continue
        variants = int(shot.get("variant_count") or 1)
        total += max(1, variants)
    return total


def validate_downstream_limit(
    *,
    phase1_seed_count: int = 0,
    shots: list[dict] | None = None,
    max_downstream: int = MAX_DOWNSTREAM,
) -> str | None:
    total = count_downstream(phase1_seed_count=phase1_seed_count, shots=shots)
    if total > max_downstream:
        return f"downstream {total} exceeds max {max_downstream}"
    return None


def validate_shots_per_macro(shots: list[dict] | None, macro_scheme_id: str) -> str | None:
    count = sum(
        1
        for s in (shots or [])
        if isinstance(s, dict) and str(s.get("macro_scheme_id") or "") == macro_scheme_id
    )
    if count > MAX_SHOTS_PER_MACRO_SCHEME:
        return f"macro {macro_scheme_id!r} has {count} shots (max {MAX_SHOTS_PER_MACRO_SCHEME})"
    return None
