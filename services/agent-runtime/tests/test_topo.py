"""Unit tests for topological sort of auto-generate image keys."""

from __future__ import annotations

import pytest

from app.graph.topo import topo_sort_image_keys


def test_topo_white_bg_before_hero():
    items = [
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": ["white_bg"]},
        {"key": "white_bg", "target_type": "image", "auto_generate": True, "depends_on": []},
        {"key": "show_video", "target_type": "video", "auto_generate": False, "depends_on": ["hero_main"]},
    ]
    assert topo_sort_image_keys(items) == ["white_bg", "hero_main"]


def test_topo_excludes_non_auto_image_and_text():
    items = [
        {"key": "copy_main", "target_type": "text", "auto_generate": False, "depends_on": []},
        {"key": "banner", "target_type": "image", "auto_generate": True, "depends_on": []},
        {"key": "manual_img", "target_type": "image", "auto_generate": False, "depends_on": []},
    ]
    assert topo_sort_image_keys(items) == ["banner"]


def test_topo_raises_on_cycle():
    items = [
        {"key": "a", "target_type": "image", "auto_generate": True, "depends_on": ["b"]},
        {"key": "b", "target_type": "image", "auto_generate": True, "depends_on": ["a"]},
    ]
    with pytest.raises(ValueError, match="cycle"):
        topo_sort_image_keys(items)
