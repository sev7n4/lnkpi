from app.graph.media_utterance import (
    normalize_colloquial_create_verbs,
    suspected_media_create,
    suspected_vision_qa,
)


def test_normalize_sheng_yi_ge_tu():
    raw = "请帮我生一个小女孩的图片"
    out = normalize_colloquial_create_verbs(raw)
    assert "生成一个" in out or "生成" in out
    assert "小女孩" in out


def test_normalize_does_not_touch_shenghuo():
    assert normalize_colloquial_create_verbs("生活怎么样") == "生活怎么样"


def test_suspected_media_create_sheng_tu():
    assert suspected_media_create("请帮我生一个小女孩的图片") is True


def test_suspected_media_create_negative_shengyi():
    assert suspected_media_create("生意很好") is False
    assert suspected_media_create("生活怎么样") is False


def test_suspected_vision_qa():
    assert suspected_vision_qa("这个图片是什么？") is True
    assert suspected_vision_qa("看看这张图") is True
    assert suspected_vision_qa("今天天气如何") is False
