"""Tests for explore tool subset builder (Phase 2b)."""

from unittest.mock import MagicMock

from app.tools.definitions import (
    EXPLORE_READ_TOOLS,
    EXPLORE_WRITE_TOOLS,
    build_explore_tools_subset,
)
from app.tools.tool_registry import EXPLORE_TOOL_NAMES


def test_read_subset_within_explore_whitelist():
    tools = build_explore_tools_subset(MagicMock(), EXPLORE_READ_TOOLS)
    names = {t.name for t in tools}
    assert names == EXPLORE_READ_TOOLS
    assert names <= EXPLORE_TOOL_NAMES


def test_write_default_subset_at_most_five():
    subset = frozenset({
        "set_node_prompt",
        "set_node_content",
        "attach_refs",
        "duplicate_node",
        "upsert_prompt_node",
    })
    tools = build_explore_tools_subset(MagicMock(), subset)
    assert len(tools) <= 5
    assert {t.name for t in tools} <= EXPLORE_WRITE_TOOLS
