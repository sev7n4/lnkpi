"""W13: gen order precomputed at split."""

from __future__ import annotations

from app.graph.topo import precompute_gen_order


def test_precompute_gen_order_success():
    manifest = [
        {"key": "white_bg", "target_type": "image", "auto_generate": True, "depends_on": []},
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": ["white_bg"]},
    ]
    ordered, err = precompute_gen_order(manifest)
    assert err is None
    assert ordered == ["white_bg", "hero_main"]


def test_precompute_gen_order_cycle():
    manifest = [
        {"key": "a", "target_type": "image", "auto_generate": True, "depends_on": ["b"]},
        {"key": "b", "target_type": "image", "auto_generate": True, "depends_on": ["a"]},
    ]
    ordered, err = precompute_gen_order(manifest)
    assert ordered is None
    assert err is not None
