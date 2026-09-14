"""Chat lane (explore node) injects sidebar parse on SystemMessage, not HumanMessage."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.nodes.explore import make_explore_node

PARSE_OK = {
    "vision_used": True,
    "user_facing_summary": "不锈钢水杯",
    "fields": {"category": "水杯"},
    "unknown": ["price_band"],
}

USER_TEXT = "这个产品是什么？"


def _patch_tools(explore_mod):
    fake = MagicMock()
    fake.name = "set_node_prompt"
    fake.ainvoke = AsyncMock(return_value={"ok": True})
    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [fake]
    return original


@pytest.mark.asyncio
async def test_chat_injects_parse_on_system_and_prefixes_reply():
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

    messages = llm.ainvoke.await_args.args[0]
    assert isinstance(messages[0], SystemMessage)
    assert "【侧栏参考图解析】" in messages[0].content
    human = messages[-1]
    assert isinstance(human, HumanMessage)
    assert isinstance(human.content, str)
    assert human.content == USER_TEXT
    assert "image_url" not in repr(messages)
    assert isinstance(result["messages"][0], AIMessage)
    assert result["messages"][0].content.startswith("根据参考图：")
