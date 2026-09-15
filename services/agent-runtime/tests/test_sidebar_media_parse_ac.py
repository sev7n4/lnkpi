"""Acceptance cases AC-01..09 for sidebar media parse (all mocks, no live HTTP).

Chat lane is explore (M2a): AC-01/08/09 go through ``make_explore_node``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.nodes.explore import make_explore_node
from app.graph.nodes.parse_sidebar_media import make_parse_sidebar_media_node
from app.graph.sidebar_media_parse import NON_VISION_PARSE_ERROR

URL_A = "https://cdn.example/cup.jpg"
URL_B = "https://cdn.example/lid.jpg"
NODE_ID = "image-1786157513657-20"
NODE_TITLE = "换logo李宁"
SUMMARY = "一只不锈钢水杯"
CATEGORY = "水杯"
CHANNEL_FLASH = "ch_x::deepseek-flash"

EMPTY_LISTING_RULE = (
    "4. 参考图未能识别。禁止 upsert_media_node / upsert_prompt_node / set_node_prompt "
    "写出空品类、空规格的上架方案框架；"
    "用文字说明失败并询问用户。"
)

OK_PAYLOAD = {
    "pass": True,
    "reason": "ok",
    "visionUsed": True,
    "productSummary": "不锈钢水杯",
    "userFacingSummary": SUMMARY,
    "category": CATEGORY,
    "appearance": "银白圆柱",
    "isWhiteBg": True,
    "isSharpEnough": True,
    "productIdentifiable": True,
    "unknown": ["price_band"],
}


class FakeVisionNest:
    def __init__(self, payload: dict | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.payload = dict(payload or OK_PAYLOAD)

    async def run_vision_qa(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return dict(self.payload)


def _image_att(url: str) -> dict[str, str]:
    return {"mediaType": "image", "url": url}


def _parse_node(nest: FakeVisionNest, *, model: str = "deepseek-flash"):
    return make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={"model": model},
        skills_dir=".",
    )


def _patch_tools(explore_mod):
    fake = MagicMock()
    fake.name = "set_node_prompt"
    fake.ainvoke = AsyncMock(return_value={"ok": True})
    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: [fake]
    return original


def _canvas_nodes() -> dict:
    return {"nodes": [{"id": NODE_ID, "title": NODE_TITLE}]}


async def _run_explore(*, parse: dict | None, user_text: str, llm_reply: str = "这是一只水杯。"):
    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content=llm_reply))

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value=_canvas_nodes())

    import app.graph.nodes.explore as explore_mod

    original = _patch_tools(explore_mod)
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        state: dict[str, Any] = {"messages": [HumanMessage(content=user_text)]}
        if parse is not None:
            state["sidebar_media_parse"] = parse
        result = await explore(state)
    finally:
        explore_mod.build_explore_tools = original

    messages = llm.ainvoke.await_args.args[0]
    return result, messages


def _system_text(messages) -> str:
    assert isinstance(messages[0], SystemMessage)
    return str(messages[0].content)


def _has_image_url_structure(messages) -> bool:
    if "image_url" in repr(messages):
        return True
    for msg in messages:
        content = getattr(msg, "content", None)
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and (
                    part.get("type") == "image_url" or "image_url" in part
                ):
                    return True
    return False


@pytest.mark.asyncio
async def test_ac01_parse_then_explore_reply_uses_summary_not_node_id():
    nest = FakeVisionNest()
    parse_out = await _parse_node(nest)(
        {
            "sidebar_attachments": [_image_att(URL_A)],
            "messages": [HumanMessage(content="这个产品是什么？")],
        }
    )
    parse = parse_out["sidebar_media_parse"]
    assert nest.calls, "new image chip must trigger parse"
    result, messages = await _run_explore(parse=parse, user_text="这个产品是什么？")
    reply = result["messages"][0].content
    assert SUMMARY in reply
    assert CATEGORY in _system_text(messages) or CATEGORY in reply
    assert NODE_ID not in reply
    assert NODE_TITLE not in reply


@pytest.mark.asyncio
async def test_ac02_explore_system_has_category_and_unknown_not_file_copout():
    nest = FakeVisionNest()
    parse_out = await _parse_node(nest)(
        {
            "sidebar_attachments": [_image_att(URL_A)],
            "messages": [
                HumanMessage(content="请帮我设计这个产品的电商产品上架方案")
            ],
        }
    )
    result, messages = await _run_explore(
        parse=parse_out["sidebar_media_parse"],
        user_text="请帮我设计这个产品的电商产品上架方案",
        llm_reply="按解析出的品类写上架模块，价格带待确认。",
    )
    system = _system_text(messages)
    assert CATEGORY in system
    assert "price_band" in system
    assert "不要声称只能看到文件名" in system
    reply = result["messages"][0].content
    assert "只能看到文件" not in reply
    assert "只能读到文件" not in reply


@pytest.mark.asyncio
async def test_ac03_same_url_second_vision_qa_count_is_zero():
    nest = FakeVisionNest()
    node = _parse_node(nest)
    first = await node({"sidebar_attachments": [_image_att(URL_A)]})
    assert len(nest.calls) == 1
    second = await node(
        {
            "sidebar_attachments": [_image_att(URL_A)],
            "sidebar_media_parse_cache": first["sidebar_media_parse_cache"],
        }
    )
    assert len(nest.calls) == 1
    assert second["sidebar_media_parse"]["user_facing_summary"] == SUMMARY


@pytest.mark.asyncio
async def test_ac04_new_url_calls_vision_qa_again():
    nest = FakeVisionNest()
    node = _parse_node(nest)
    first = await node({"sidebar_attachments": [_image_att(URL_A)]})
    nest.payload = {
        **OK_PAYLOAD,
        "userFacingSummary": "一个木盖",
        "category": "木盖",
        "productSummary": "木盖",
    }
    second = await node(
        {
            "sidebar_attachments": [_image_att(URL_B)],
            "sidebar_media_parse_cache": first["sidebar_media_parse_cache"],
        }
    )
    assert len(nest.calls) == 2
    assert nest.calls[1]["image_urls"] == [URL_B]
    assert second["sidebar_media_parse"]["fields"]["category"] == "木盖"


@pytest.mark.asyncio
async def test_ac05_text_chip_does_not_call_nest():
    nest = FakeVisionNest()
    out = await _parse_node(nest)(
        {
            "sidebar_attachments": [{"mediaType": "text", "text": "这是什么"}],
            "messages": [HumanMessage(content="这是什么")],
        }
    )
    assert nest.calls == []
    assert not out.get("sidebar_media_parse")


@pytest.mark.asyncio
async def test_ac06_channel_prefixed_flash_passed_to_nest_as_is():
    nest = FakeVisionNest()
    out = await _parse_node(nest, model=CHANNEL_FLASH)(
        {"sidebar_attachments": [_image_att(URL_A)]}
    )
    assert nest.calls[0]["model"] == CHANNEL_FLASH
    assert out["sidebar_media_parse"]["vision_used"] is True


@pytest.mark.asyncio
async def test_ac07_non_vision_prefix_and_explore_forbids_empty_listing():
    nest = FakeVisionNest(payload={"visionUsed": False, "reason": "text-only fallback"})
    parse_out = await _parse_node(nest, model="deepseek-v4-pro")(
        {"sidebar_attachments": [_image_att(URL_A)]}
    )
    parse = parse_out["sidebar_media_parse"]
    assert parse["vision_used"] is False
    result, messages = await _run_explore(
        parse=parse,
        user_text="请帮我设计这个产品的电商产品上架方案",
        llm_reply="无法识别。",
    )
    reply = result["messages"][0].content
    assert NON_VISION_PARSE_ERROR in reply
    assert reply.startswith("未能根据参考图识别产品。")
    system = _system_text(messages)
    assert EMPTY_LISTING_RULE in system
    assert "空品类" in system


@pytest.mark.asyncio
async def test_ac08_no_attachment_chat_has_no_parse_block():
    nest = FakeVisionNest()
    parse_out = await _parse_node(nest)(
        {
            "sidebar_attachments": [],
            "messages": [HumanMessage(content="今天天气")],
        }
    )
    assert nest.calls == []
    assert not parse_out.get("sidebar_media_parse")
    result, messages = await _run_explore(
        parse=None,
        user_text="今天天气",
        llm_reply="今天天气不错。",
    )
    system = _system_text(messages)
    # Standing explore rule 7 names the heading; the parse context block is not injected.
    assert "请基于以上理解回答或写方案" not in system
    assert "品类：" not in system
    assert not result["messages"][0].content.startswith("根据参考图：")


@pytest.mark.asyncio
async def test_ac09_explore_ainvoke_content_has_no_image_url():
    nest = FakeVisionNest()
    parse_out = await _parse_node(nest)(
        {"sidebar_attachments": [_image_att(URL_A)]}
    )
    _, messages = await _run_explore(
        parse=parse_out["sidebar_media_parse"],
        user_text="这个产品是什么？",
    )
    assert not _has_image_url_structure(messages)
    human = messages[-1]
    assert isinstance(human, HumanMessage)
    assert isinstance(human.content, str)
    assert human.content == "这个产品是什么？"
