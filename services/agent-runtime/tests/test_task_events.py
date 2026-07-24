"""Tests for task_events helpers and video-aware topo."""

from __future__ import annotations

import pytest

from app.graph.task_events import hint_for_error, is_recoverable, max_auto_retries
from app.graph.topo import topo_sort_gen_keys, topo_sort_image_keys


def test_topo_includes_video_after_image_dep():
    manifest = [
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": []},
        {
            "key": "show_video",
            "target_type": "video",
            "auto_generate": True,
            "depends_on": ["hero_main"],
        },
    ]
    assert topo_sort_gen_keys(manifest) == ["hero_main", "show_video"]


def test_topo_image_keys_still_excludes_video():
    manifest = [
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": []},
        {
            "key": "show_video",
            "target_type": "video",
            "auto_generate": True,
            "depends_on": ["hero_main"],
        },
    ]
    assert topo_sort_image_keys(manifest) == ["hero_main"]


def test_fallback_pending_not_recoverable():
    assert is_recoverable("fallback_pending") is False
    assert "确认平台" in hint_for_error("fallback_pending")


def test_timeout_is_recoverable():
    assert is_recoverable("timeout") is True
    assert max_auto_retries() == 2
