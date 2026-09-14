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
    parse = first["sidebar_media_parse"]
    assert parse["vision_used"] is True
    assert parse["fields"]["category"] == "水杯"
    assert parse["user_facing_summary"] == "一只不锈钢水杯"
    assert parse["qa"]["is_white_bg"] is True
    assert parse["qa"]["is_sharp_enough"] is True
    assert parse["qa"]["product_identifiable"] is True
    assert parse["qa"]["product_summary"] == "不锈钢水杯"
    assert len(nest.calls) == 1
    assert nest.calls[0]["image_urls"] == ["https://cdn.example/p.jpg"]
    assert nest.calls[0]["model"] == "deepseek-flash"
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
    assert out["sidebar_media_parse"]["error"] != NON_VISION_PARSE_ERROR


@pytest.mark.asyncio
async def test_non_vision_copy_when_vision_used_false():
    class NonVision:
        async def run_vision_qa(self, **kwargs):
            return {"visionUsed": False, "reason": "text-only fallback"}

    node = make_parse_sidebar_media_node(
        nest=NonVision(),
        vision_creds={"model": "deepseek-v4-pro"},
        skills_dir=".",
    )
    out = await node({"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]})
    assert out["sidebar_media_parse"]["error"] == NON_VISION_PARSE_ERROR


@pytest.mark.asyncio
async def test_partial_cache_miss_rebuilds_from_all_current_urls():
    class Boom:
        async def run_vision_qa(self, **kwargs):
            raise RuntimeError("upstream 500")

    url_a = "https://cdn.example/a.jpg"
    url_b = "https://cdn.example/b.jpg"
    node = make_parse_sidebar_media_node(
        nest=Boom(),
        vision_creds={"model": "gpt-4o"},
        skills_dir=".",
    )
    cached_a = {
        "vision_used": True,
        "user_facing_summary": "一只不锈钢水杯",
        "fields": {"category": "水杯"},
        "unknown": [],
        "image_urls": [url_a],
        "qa": {
            "product_summary": "不锈钢水杯",
            "is_white_bg": True,
            "is_sharp_enough": True,
            "product_identifiable": True,
        },
    }
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "url": url_a},
                {"mediaType": "image", "url": url_b},
            ],
            "sidebar_media_parse_cache": {url_a: cached_a},
        }
    )
    parse = out["sidebar_media_parse"]
    assert parse["fields"]["category"] == "水杯"
    assert parse["user_facing_summary"] == "一只不锈钢水杯"
    assert parse["vision_used"] is True
    assert "error" not in parse
