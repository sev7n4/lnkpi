"""Tests for classify_explore_intent."""

from app.graph.explore_dispatch import MANDATORY_INTENTS, classify_explore_intent

SUMMARY = {
    "nodes": [
        {"id": "image-1786157513657-20", "title": "换logo李宁"},
        {"id": "image-16", "title": "demo"},
    ]
}

# Subset of deploy/prod-explore-28-tools-demo.py utterances
CASES = [
    ("查询画布，撤销上一步画布编辑操作", "ui_command"),
    ("查询画布，重做刚才撤销的画布操作", "ui_command"),
    ("查询「换logo李宁」节点，把视口定位到它", "ui_command"),
    ("查询颜色变体1到4节点，把视口定位到它们", "ui_command"),
    ("查询「换logo李宁」图片节点并打开精修编辑器", "ui_command"),
    ("查询「换logo李宁」节点并引入到 Agent 侧栏对话上下文", "ui_command"),
    ("取消 image-16 节点上正在进行的生成任务", "lifecycle"),
    ("查询「让模特穿上这双鞋子」节点，取消这次平台回退 fallback", "lifecycle"),
    ("查询「让模特穿上这双鞋子」节点，确认使用平台通道继续 fallback", "lifecycle"),
    ("查询我的资产库有哪些素材，列出名称和类型", "asset_read"),
    ("查询平台公共素材库有哪些内容", "asset_read"),
    ("查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-测试文案", "node_write"),
    ("查询节点 image-16 的详细信息，包括 url 和 status", "node_read"),
    ("查询 image-16 这个节点当前的生成状态", "node_read"),
    ("查询画布上有哪些节点？列出每个节点的类型和状态", "open_query"),
]


def test_mandatory_intents_set():
    assert MANDATORY_INTENTS == frozenset({"ui_command", "lifecycle", "asset_read"})


def test_classify_demo_utterances():
    for text, expected in CASES:
        assert classify_explore_intent(text, summary=SUMMARY) == expected, text
