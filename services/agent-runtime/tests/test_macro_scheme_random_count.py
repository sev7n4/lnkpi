"""Macro scheme random count (1..4) and trim helpers."""

from __future__ import annotations

import random

from app.graph.product_visual_v2.macro_select import (
    pick_macro_scheme_target_count,
    trim_macro_schemes_to_count,
)


def test_pick_macro_scheme_target_count_range():
    rng = random.Random(0)
    counts = {pick_macro_scheme_target_count(rng=rng) for _ in range(200)}
    assert counts <= {1, 2, 3, 4}
    assert counts == {1, 2, 3, 4}


def test_trim_macro_schemes_prefers_recommended():
    schemes = [
        {"id": "A", "recommended": False},
        {"id": "B", "recommended": True},
        {"id": "C", "recommended": False},
    ]
    assert trim_macro_schemes_to_count(schemes, 2) == [
        {"id": "B", "recommended": True},
        {"id": "A", "recommended": False},
    ]


def test_trim_macro_schemes_keeps_single_for_auto_select():
    schemes = [
        {"id": "A", "label": "only", "recommended": True},
        {"id": "B", "label": "extra", "recommended": False},
    ]
    trimmed = trim_macro_schemes_to_count(schemes, 1)
    assert len(trimmed) == 1
    assert trimmed[0]["id"] == "A"
