from app.graph.sidebar_media_parse import (
    NON_VISION_PARSE_ERROR,
    classify_vision_error,
    format_parse_context_block,
    image_urls_for_parse,
    is_retryable_parse_error,
    map_vision_error_class,
    media_parse_cache_key,
    merge_parse_records,
    prefix_assistant_reply,
    uncached_urls,
)


def test_skips_text_and_empty_url():
    urls = image_urls_for_parse(
        [
            {"mediaType": "text", "text": "hi"},
            {"mediaType": "image", "url": ""},
            {"mediaType": "image", "url": " https://cdn.example/a.jpg "},
        ]
    )
    assert urls == ["https://cdn.example/a.jpg"]


def test_caps_at_four():
    atts = [{"mediaType": "image", "url": f"https://x/{i}.jpg"} for i in range(6)]
    assert len(image_urls_for_parse(atts)) == 4


def test_uncached_skips_known():
    ref = "ch_a::flash"
    assert uncached_urls(
        ["https://a", "https://b"],
        {media_parse_cache_key("https://a", ref): {"vision_used": True}},
        provider_ref=ref,
    ) == ["https://b"]


def test_uncached_urls_scoped_by_provider_ref():
    cache = {
        media_parse_cache_key("https://a", "ch_a::flash"): {
            "vision_used": True,
            "user_facing_summary": "x",
        }
    }
    assert uncached_urls(["https://a"], cache, provider_ref="ch_b::flash") == ["https://a"]
    assert uncached_urls(["https://a"], cache, provider_ref="ch_a::flash") == []


def test_uncached_retries_timeout_and_429():
    ref = "ch::flash"
    cache = {
        media_parse_cache_key("https://a", ref): {
            "vision_used": False,
            "error": map_vision_error_class("VISION_TIMEOUT"),
        },
        media_parse_cache_key("https://b", ref): {
            "vision_used": False,
            "error": map_vision_error_class("VISION_RATE_LIMIT"),
        },
        media_parse_cache_key("https://c", ref): {
            "vision_used": False,
            "error": NON_VISION_PARSE_ERROR,
        },
        media_parse_cache_key("https://d", ref): {
            "vision_used": True,
            "user_facing_summary": "ok",
        },
    }
    assert uncached_urls(
        ["https://a", "https://b", "https://c", "https://d", "https://e"],
        cache,
        provider_ref=ref,
    ) == ["https://a", "https://b", "https://e"]


def test_is_retryable_parse_error():
    assert is_retryable_parse_error(map_vision_error_class("VISION_TIMEOUT"))
    assert is_retryable_parse_error(map_vision_error_class("VISION_RATE_LIMIT"))
    assert is_retryable_parse_error("Vision API 429: rate limit")
    assert not is_retryable_parse_error(NON_VISION_PARSE_ERROR)
    assert not is_retryable_parse_error(None)


def test_map_vision_error_class_strips_upstream_english():
    assert "不支持识图" in map_vision_error_class("VISION_UNSUPPORTED")
    assert "GPT-4o" in map_vision_error_class("VISION_UNSUPPORTED")
    assert map_vision_error_class("VISION_RATE_LIMIT") == "识图请求过于频繁，请稍后再试"
    assert "Upgrade" not in map_vision_error_class("VISION_RATE_LIMIT")
    assert map_vision_error_class("VISION_TIMEOUT") == "识图超时，请稍后重试"
    assert map_vision_error_class("VISION_FETCH_FAILED") == "参考图读取失败，请重新上传"
    assert map_vision_error_class("VISION_PROVIDER_CONTEXT_INVALID") == (
        "识图凭证不完整，请重新选择模型后再试"
    )
    assert map_vision_error_class("VISION_BYOK_MISSING_KEY") == "自定义渠道未配置 API Key"


def test_classify_vision_error_from_reason_strings():
    assert classify_vision_error(reason="HTTP 429 rate limit exceeded") == "VISION_RATE_LIMIT"
    assert classify_vision_error(reason="Request timed out after 120s") == "VISION_TIMEOUT"
    assert classify_vision_error(reason="fetch failed: download error") == "VISION_FETCH_FAILED"
    assert classify_vision_error(reason="upstream 500 boom") == "VISION_UPSTREAM"
    assert (
        classify_vision_error(payload={"errorClass": "VISION_BYOK_MISSING_KEY"})
        == "VISION_BYOK_MISSING_KEY"
    )


def test_merge_joins_summaries():
    ref = "ch::flash"
    cache = {
        media_parse_cache_key("https://a", ref): {
            "user_facing_summary": "红桶",
            "fields": {"category": "水桶"},
            "unknown": ["platform"],
        },
        media_parse_cache_key("https://b", ref): {
            "user_facing_summary": "木盖",
            "fields": {},
            "unknown": ["price_band"],
        },
    }
    merged = merge_parse_records(["https://a", "https://b"], cache, provider_ref=ref)
    assert "红桶" in merged["user_facing_summary"]
    assert "木盖" in merged["user_facing_summary"]
    assert merged["fields"]["category"] == "水桶"
    assert set(merged["unknown"]) == {"platform", "price_band"}

def test_prefix_success_and_failure():
    ok = prefix_assistant_reply("这是水杯。", {"vision_used": True, "user_facing_summary": "不锈钢水杯"})
    assert ok.startswith("根据参考图：不锈钢水杯")
    bad = prefix_assistant_reply("你好", {"vision_used": False, "error": NON_VISION_PARSE_ERROR})
    assert bad.startswith("未能根据参考图识别产品。")
    assert NON_VISION_PARSE_ERROR in bad


def test_context_block_forbids_filename_copout():
    block = format_parse_context_block(
        {"user_facing_summary": "不锈钢水杯", "fields": {"category": "水杯"}, "unknown": ["price_band"]}
    )
    assert "【侧栏参考图解析】" in block
    assert "不要声称只能看到文件名" in block
