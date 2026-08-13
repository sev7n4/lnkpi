"""Downstream limits and shot_id validation (spec §1.5, §4.1)."""

from __future__ import annotations

import re

MAX_MACRO_SCHEMES_SELECTED = 2
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


def enforce_shot_limits(
    shots: list[dict],
    selected_macro_ids: list[str] | None = None,
    *,
    phase1_seed_count: int = 0,
    max_per_macro: int = MAX_SHOTS_PER_MACRO_SCHEME,
    max_downstream: int = MAX_DOWNSTREAM,
) -> tuple[list[dict], list[str]]:
    """
    Trim shots per macro and total downstream instead of hard-failing.
    Preserves original order within each macro group.
    """
    notes: list[str] = []
    if not shots:
        return [], notes

    selected = [str(s).strip() for s in (selected_macro_ids or []) if str(s).strip()]
    by_macro: dict[str, list[dict]] = {}
    other: list[dict] = []

    for shot in shots:
        if not isinstance(shot, dict):
            continue
        mid = str(shot.get("macro_scheme_id") or "").strip()
        if selected and mid and mid not in selected:
            continue
        bucket = by_macro.setdefault(mid or "__none__", [])
        bucket.append(shot)

    trimmed: list[dict] = []
    macro_keys = selected or list(by_macro.keys())
    for mid in macro_keys:
        group = by_macro.get(mid, [])
        if len(group) > max_per_macro:
            label = mid if mid != "__none__" else "默认"
            notes.append(
                f"方案 {label} 构图较多，已合并为 {max_per_macro} 个（原 {len(group)} 个）"
            )
            group = group[:max_per_macro]
        trimmed.extend(group)

    if not selected:
        for mid, group in by_macro.items():
            if mid in macro_keys:
                continue
            if len(group) > max_per_macro:
                notes.append(f"方案 {mid} 构图较多，已合并为 {max_per_macro} 个")
                group = group[:max_per_macro]
            trimmed.extend(group)

    while trimmed and count_downstream(phase1_seed_count=phase1_seed_count, shots=trimmed) > max_downstream:
        dropped = trimmed.pop()
        label = str(dropped.get("label") or dropped.get("shot_id") or "构图")
        notes.append(f"出图任务量超限，已省略末位构图「{label}」")
        if not any("出图任务量超限" in n for n in notes[:-1]):
            notes.append(f"单次最多支持 {max_downstream} 个出图任务（含变体）")

    return trimmed, notes
