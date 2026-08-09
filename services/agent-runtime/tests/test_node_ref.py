"""Tests for resolve_node_ref SSOT."""

from app.graph.node_ref import (
    extract_quoted_title,
    resolve_node_ref,
    resolve_node_refs,
)

SUMMARY = {
    "nodes": [
        {
            "id": "image-1786157513657-20",
            "title": "换logo李宁",
            "type": "image",
            "status": "completed",
        },
        {
            "id": "image-1786156321418-15",
            "title": "颜色变体1",
            "type": "image",
            "status": "completed",
        },
        {
            "id": "image-1786156321418-16",
            "title": "颜色变体2",
            "type": "image",
            "status": "completed",
        },
        {
            "id": "prompt-1786156321418-99",
            "title": "主文案",
            "type": "prompt",
            "status": "completed",
        },
    ]
}


def test_resolve_explicit_node_id():
    assert resolve_node_ref("查询 image-16 状态", SUMMARY) == "image-16"
    assert resolve_node_ref("更新 prompt-1786156321418-99 的 prompt", SUMMARY) == (
        "prompt-1786156321418-99"
    )


def test_resolve_quoted_title():
    assert extract_quoted_title("查询「换logo李宁」节点") == "换logo李宁"
    assert extract_quoted_title('定位"主文案"') == "主文案"
    assert resolve_node_ref("查询「换logo李宁」节点", SUMMARY) == "image-1786157513657-20"


def test_resolve_title_substring_without_quotes():
    assert resolve_node_ref("看看换logo李宁什么情况", SUMMARY) == "image-1786157513657-20"


def test_resolve_node_refs_prefix_range():
    ids = resolve_node_refs("颜色变体1到4", SUMMARY)
    assert len(ids) >= 2
    assert "image-1786156321418-15" in ids
    assert "image-1786156321418-16" in ids


def test_resolve_node_refs_comma_separated():
    ids = resolve_node_refs("定位 image-1786156321418-15, image-1786156321418-16", SUMMARY)
    assert ids == ["image-1786156321418-15", "image-1786156321418-16"]


def test_resolve_no_match_returns_none():
    assert resolve_node_ref("看看画布整体布局", SUMMARY) is None
    assert resolve_node_refs("看看画布整体布局", SUMMARY) == []
