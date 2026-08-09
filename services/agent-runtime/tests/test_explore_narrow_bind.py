"""Tests for narrow bind tool selection (Phase 2b)."""

from app.graph.explore_dispatch import select_explore_tool_names, select_narrow_write_tools
from app.tools.definitions import EXPLORE_READ_TOOLS
from app.tools.tool_registry import EXPLORE_TOOL_NAMES


def test_node_read_binds_read_subset():
    names = select_explore_tool_names("node_read", "查询 image-16 状态")
    assert names == EXPLORE_READ_TOOLS
    assert len(names) <= 10


def test_node_write_narrow_by_prompt_keyword():
    names = select_narrow_write_tools("查询 prompt-1 节点，更新 prompt 字段")
    assert names == frozenset({"set_node_prompt", "upsert_prompt_node"})
    assert len(names) <= 5


def test_node_write_narrow_by_upload_keyword():
    names = select_narrow_write_tools("上传 https://picsum.photos/512 到画布")
    assert names == frozenset({"upload_media_to_canvas"})


def test_open_query_binds_full_whitelist():
    names = select_explore_tool_names("open_query", "查询画布上有哪些节点")
    assert names == EXPLORE_TOOL_NAMES
