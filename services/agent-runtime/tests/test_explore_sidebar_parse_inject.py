"""Explore injects sidebar parse into system and prefixes replies, including mandatory."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.nodes.explore import make_explore_node
from app.graph.sidebar_media_parse import NON_VISION_PARSE_ERROR

PARSE_OK = {
    "vision_used": True,
    "user_facing_summary": "不锈钢水杯",
    "fields": {"category": "水杯"},
    "unknown": ["price_band"],
}

PARSE_FAIL = {
    "vision_used": False,
    "error": NON_VISION_PARSE_ERROR,
    "user_facing_summary": "",
    "fields": {},
}

USER_TEXT = "这个产品是什么？"
EMPTY_LISTING_RULE = (
    "4. 参考图未能识别。禁止 upsert_media_node / upsert_prompt_node / set_node_prompt "
    "写出空品类、空规格的上架方案框架；"
    "用文字说明失败并询问用户。"
)


def _patch_tools(explore_mod, *, undo=False):
    fake = MagicMock()
    fake.name = "undo" if undo else "set_node_prompt"
    fake.ainvoke = AsyncMock(
        return_value={"ok": True, "canvasCommands": [{"type": "undo"}]} if undo else {"ok": True}
    )
    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [fake]
    return original


@pytest.mark.asyncio
async def test_explore_system_contains_parse_block_without_image_url():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="这是一只水杯。"))

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})

    import app.graph.nodes.explore as explore_mod

    original = _patch_tools(explore_mod)
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore(
            {
                "messages": [HumanMessage(content=USER_TEXT)],
                "sidebar_media_parse": PARSE_OK,
            }
        )
    finally:
        explore_mod.build_explore_tools = original

    llm.bind_tools.assert_called()
    messages = llm.ainvoke.await_args.args[0]
    assert isinstance(messages[0], SystemMessage)
    assert "【侧栏参考图解析】" in messages[0].content
    human = messages[-1]
    assert isinstance(human, HumanMessage)
    assert isinstance(human.content, str)
    assert human.content == USER_TEXT
    assert "image_url" not in repr(messages)
    assert result["messages"][0].content.startswith("根据参考图：")


@pytest.mark.asyncio
async def test_explore_vision_false_forbids_empty_listing_nodes():
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="无法识别。"))

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})

    import app.graph.nodes.explore as explore_mod

    original = _patch_tools(explore_mod)
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore(
            {
                "messages": [HumanMessage(content=USER_TEXT)],
                "sidebar_media_parse": PARSE_FAIL,
            }
        )
    finally:
        explore_mod.build_explore_tools = original

    messages = llm.ainvoke.await_args.args[0]
    system = messages[0].content
    assert EMPTY_LISTING_RULE in system
    assert "禁止创建空品类上架方案" in system or "空品类" in system
    assert result["messages"][0].content.startswith("未能根据参考图识别产品。")


@pytest.mark.asyncio
async def test_explore_mandatory_reply_gets_parse_prefix():
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock()

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(
        return_value={"nodes": [{"id": "image-1786157513657-20", "title": "换logo李宁"}]}
    )

    import app.graph.nodes.explore as explore_mod

    original = _patch_tools(explore_mod, undo=True)
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        result = await explore(
            {
                "messages": [HumanMessage(content="查询画布，撤销上一步画布编辑操作")],
                "sidebar_media_parse": PARSE_OK,
            }
        )
    finally:
        explore_mod.build_explore_tools = original

    assert llm.ainvoke.await_count == 0
    assert result["messages"][0].content.startswith("根据参考图：")
