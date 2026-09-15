from unittest.mock import AsyncMock

import pytest

from app.graph.nodes.parse_sidebar_media import make_parse_sidebar_media_node
from app.graph.sidebar_media_parse import (
    NON_VISION_PARSE_ERROR,
    map_vision_error_class,
    media_parse_cache_key,
)

FLASH_CREDS = {
    "provider_ref": "ch_x::deepseek-flash",
    "model": "deepseek-flash",
    "api_key": "sk-test",
    "base_url": "https://api.example/v1",
    "source": "user",
}

GPT_CREDS = {
    "provider_ref": "platform::gpt-4o",
    "model": "gpt-4o",
    "api_key": "sk-platform",
    "base_url": "https://api.openai.com/v1",
    "source": "platform",
}


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
        vision_creds=FLASH_CREDS,
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
    assert nest.calls[0]["provider_ref"] == "ch_x::deepseek-flash"
    assert nest.calls[0]["api_key"] == "sk-test"
    assert nest.calls[0]["base_url"] == "https://api.example/v1"
    assert nest.calls[0]["source"] == "user"
    key = media_parse_cache_key("https://cdn.example/p.jpg", FLASH_CREDS["provider_ref"])
    assert key in first["sidebar_media_parse_cache"]
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
    node = make_parse_sidebar_media_node(nest=nest, vision_creds=FLASH_CREDS, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "text", "text": "hi"}]})
    assert nest.calls == []
    assert not out.get("sidebar_media_parse")


@pytest.mark.asyncio
async def test_clears_parse_when_turn_has_no_image_urls():
    nest = _Nest()
    node = make_parse_sidebar_media_node(nest=nest, vision_creds=FLASH_CREDS, skills_dir=".")
    prev = {
        "vision_used": True,
        "user_facing_summary": "一只不锈钢水杯",
        "fields": {"category": "水杯"},
    }
    out = await node(
        {
            "sidebar_attachments": [{"mediaType": "text", "text": "hi"}],
            "sidebar_media_parse": prev,
            "sidebar_media_parse_cache": {
                media_parse_cache_key("https://cdn.example/p.jpg", FLASH_CREDS["provider_ref"]): prev
            },
        }
    )
    assert nest.calls == []
    assert out["sidebar_media_parse"] is None
    assert "sidebar_media_parse_cache" not in out


@pytest.mark.asyncio
async def test_nest_error_becomes_vision_false(monkeypatch):
    class Boom:
        async def run_vision_qa(self, **kwargs):
            raise RuntimeError("upstream 500")

    node = make_parse_sidebar_media_node(nest=Boom(), vision_creds=GPT_CREDS, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]})
    assert out["sidebar_media_parse"]["vision_used"] is False
    assert out["sidebar_media_parse"]["error"]
    assert out["sidebar_media_parse"]["error"] != NON_VISION_PARSE_ERROR
    assert "upstream 500" not in out["sidebar_media_parse"]["error"]
    assert out["sidebar_media_parse"]["error"] == map_vision_error_class("VISION_UPSTREAM")


@pytest.mark.asyncio
async def test_parse_skips_nest_when_model_not_vision():
    nest = AsyncMock()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={
            "provider_ref": "ch::deepseek-v4-pro",
            "model": "deepseek-v4-pro",
            "api_key": "sk-test",
            "base_url": "https://api.example/v1",
            "source": "user",
        },
        skills_dir=".",
    )
    out = await node(
        {"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]}
    )
    nest.run_vision_qa.assert_not_called()
    assert "不支持识图" in (out["sidebar_media_parse"]["error"] or "")
    assert out["sidebar_media_parse"]["error"] == NON_VISION_PARSE_ERROR


@pytest.mark.asyncio
async def test_incomplete_context_skips_nest():
    nest = AsyncMock()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={"provider_ref": None, "model": "deepseek-flash", "api_key": None, "base_url": None, "source": None},
        skills_dir=".",
    )
    out = await node(
        {"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]}
    )
    nest.run_vision_qa.assert_not_called()
    assert out["sidebar_media_parse"]["error"] == map_vision_error_class(
        "VISION_PROVIDER_CONTEXT_INVALID"
    )


@pytest.mark.asyncio
async def test_byok_missing_key_skips_nest():
    nest = AsyncMock()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={
            "provider_ref": "ch_byok::deepseek-flash",
            "model": "deepseek-flash",
            "api_key": "",
            "base_url": "https://api.example/v1",
            "source": "user",
        },
        skills_dir=".",
    )
    out = await node(
        {"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]}
    )
    nest.run_vision_qa.assert_not_called()
    assert out["sidebar_media_parse"]["error"] == map_vision_error_class("VISION_BYOK_MISSING_KEY")


@pytest.mark.asyncio
async def test_timeout_error_not_written_to_cache_so_next_turn_retries():
    class TimeoutOnce:
        def __init__(self):
            self.calls = 0

        async def run_vision_qa(self, **kwargs):
            self.calls += 1
            if self.calls <= 3:
                raise RuntimeError("操作超时，请稍后重试")
            return {
                "visionUsed": True,
                "userFacingSummary": "汽车HUD",
                "category": "汽车电子",
                "isWhiteBg": True,
                "isSharpEnough": True,
                "productIdentifiable": True,
            }

    nest = TimeoutOnce()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds=FLASH_CREDS,
        skills_dir=".",
    )
    att = [{"mediaType": "image", "url": "https://cdn.example/hud.jpg"}]
    first = await node({"sidebar_attachments": att})
    assert first["sidebar_media_parse"]["vision_used"] is False
    assert first["sidebar_media_parse"]["error"] == map_vision_error_class("VISION_TIMEOUT")
    assert first["sidebar_media_parse_cache"] == {}
    # Same-turn retries: max 3 attempts
    assert nest.calls == 3

    class OkNest:
        def __init__(self):
            self.calls = 0

        async def run_vision_qa(self, **kwargs):
            self.calls += 1
            return {
                "visionUsed": True,
                "userFacingSummary": "汽车HUD",
                "category": "汽车电子",
                "isWhiteBg": True,
                "isSharpEnough": True,
                "productIdentifiable": True,
            }

    nest2 = OkNest()
    node2 = make_parse_sidebar_media_node(
        nest=nest2,
        vision_creds=FLASH_CREDS,
        skills_dir=".",
    )
    second = await node2(
        {
            "sidebar_attachments": att,
            "sidebar_media_parse_cache": first["sidebar_media_parse_cache"],
        }
    )
    assert nest2.calls == 1
    assert second["sidebar_media_parse"]["vision_used"] is True
    assert second["sidebar_media_parse"]["fields"]["category"] == "汽车电子"


@pytest.mark.asyncio
async def test_rate_limit_retries_then_maps_chinese(monkeypatch):
    class RateLimit:
        def __init__(self):
            self.calls = 0

        async def run_vision_qa(self, **kwargs):
            self.calls += 1
            raise RuntimeError("HTTP 429: rate limit — Upgrade to a Token Plan for more")

    nest = RateLimit()
    node = make_parse_sidebar_media_node(nest=nest, vision_creds=FLASH_CREDS, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]})
    assert nest.calls == 3
    err = out["sidebar_media_parse"]["error"]
    assert err == map_vision_error_class("VISION_RATE_LIMIT")
    assert "Upgrade" not in err
    assert out["sidebar_media_parse_cache"] == {}


@pytest.mark.asyncio
async def test_partial_cache_miss_rebuilds_from_all_current_urls():
    class Boom:
        async def run_vision_qa(self, **kwargs):
            raise RuntimeError("upstream 500")

    url_a = "https://cdn.example/a.jpg"
    url_b = "https://cdn.example/b.jpg"
    node = make_parse_sidebar_media_node(
        nest=Boom(),
        vision_creds=GPT_CREDS,
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
            "sidebar_media_parse_cache": {
                media_parse_cache_key(url_a, GPT_CREDS["provider_ref"]): cached_a
            },
        }
    )
    parse = out["sidebar_media_parse"]
    assert parse["fields"]["category"] == "水杯"
    assert parse["user_facing_summary"] == "一只不锈钢水杯"
    assert parse["vision_used"] is True
    assert "error" not in parse
