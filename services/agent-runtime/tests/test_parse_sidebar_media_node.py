from app.graph.nodes.parse_sidebar_media import make_parse_sidebar_media_node
from app.graph.sidebar_media_parse import NON_VISION_PARSE_ERROR

import pytest


class _Nest:
    def __init__(self):
        self.calls = []

    async def run_vision_qa(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "pass": True,
            "reason": "ok",
            "visionUsed": True,
            "productSummary": "不锈钢水杯",
            "userFacingSummary": "一只不锈钢水杯",
            "category": "水杯",
            "appearance": "银白",
            "isWhiteBg": True,
            "isSharpEnough": True,
            "productIdentifiable": True,
            "unknown": ["price_band"],
        }


@pytest.mark.asyncio
async def test_parses_new_image_and_skips_second_call():
    nest = _Nest()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={"model": "deepseek-flash"},
        skills_dir=".",
    )
    att = [{"mediaType": "image", "url": "https://cdn.example/p.jpg"}]
    first = await node({"sidebar_attachments": att})
    assert first["sidebar_media_parse"]["vision_used"] is True
    assert first["sidebar_media_parse"]["fields"]["category"] == "水杯"
    assert len(nest.calls) == 1
    second = await node(
        {
            "sidebar_attachments": att,
            "sidebar_media_parse_cache": first["sidebar_media_parse_cache"],
        }
    )
    assert len(nest.calls) == 1
    assert second["sidebar_media_parse"]["fields"]["category"] == "水杯"


@pytest.mark.asyncio
async def test_no_image_does_not_call_nest():
    nest = _Nest()
    node = make_parse_sidebar_media_node(nest=nest, vision_creds={}, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "text", "text": "hi"}]})
    assert nest.calls == []
    assert not out.get("sidebar_media_parse")


@pytest.mark.asyncio
async def test_nest_error_becomes_vision_false(monkeypatch):
    class Boom:
        async def run_vision_qa(self, **kwargs):
            raise RuntimeError("upstream 500")

    node = make_parse_sidebar_media_node(nest=Boom(), vision_creds={"model": "gpt-4o"}, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]})
    assert out["sidebar_media_parse"]["vision_used"] is False
    assert out["sidebar_media_parse"]["error"]
