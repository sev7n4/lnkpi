from app.graph.sidebar_media_parse import (
    NON_VISION_PARSE_ERROR,
    format_parse_context_block,
    image_urls_for_parse,
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
    assert uncached_urls(
        ["https://a", "https://b"],
        {"https://a": {"vision_used": True}},
    ) == ["https://b"]


def test_merge_joins_summaries():
    cache = {
        "https://a": {"user_facing_summary": "红桶", "fields": {"category": "水桶"}, "unknown": ["platform"]},
        "https://b": {"user_facing_summary": "木盖", "fields": {}, "unknown": ["price_band"]},
    }
    merged = merge_parse_records(["https://a", "https://b"], cache)
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
