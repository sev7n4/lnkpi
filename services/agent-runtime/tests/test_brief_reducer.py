"""W14 brief_reducer unit tests."""

from __future__ import annotations

from app.graph.state import BRIEF_RESET_PREFIX, brief_reducer


def test_brief_reducer_first_write():
    assert brief_reducer(None, "帮我做洁具详情页") == "帮我做洁具详情页"


def test_brief_reducer_rejects_second_write():
    left = "帮我做洁具详情页"
    assert brief_reducer(left, "帮我做运动鞋详情页") == left


def test_brief_reducer_reset_prefix_allows_fresh_campaign():
    assert brief_reducer("洁具 brief", BRIEF_RESET_PREFIX + "运动鞋 brief") == "运动鞋 brief"


def test_brief_reducer_none_right_keeps_left():
    assert brief_reducer("existing", None) == "existing"
