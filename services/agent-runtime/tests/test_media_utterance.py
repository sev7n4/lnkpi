import pytest

from app.graph.media_utterance import (
    media_directed_question,
    normalize_colloquial_create_verbs,
    suspected_media_create,
    suspected_vision_qa,
)

CASUAL_NEGATIVES = (
    "先生这张图不错",
    "产生了很多图表",
    "卫生间的示意图在哪",
    "学生画的图我看不懂",
    "整个图表看起来不错",
    "来个图书推荐",
    "生活怎么样",
    "生意很好",
)

CREATE_POSITIVES = (
    "请帮我生一个小女孩的图片",
    "生一张图",
    "帮我生个海报",
    "帮我弄张图看看",
)


def test_normalize_sheng_yi_ge_tu():
    raw = "请帮我生一个小女孩的图片"
    out = normalize_colloquial_create_verbs(raw)
    assert "生成一个" in out
    assert "小女孩" in out


def test_normalize_does_not_touch_shenghuo():
    assert normalize_colloquial_create_verbs("生活怎么样") == "生活怎么样"


@pytest.mark.parametrize("text", ["请帮我生成一张图", "帮我生成一个小女孩的图片"])
def test_normalize_is_idempotent_for_already_shengcheng(text: str):
    assert normalize_colloquial_create_verbs(text) == text
    assert normalize_colloquial_create_verbs(normalize_colloquial_create_verbs(text)) == text


@pytest.mark.parametrize("text", CASUAL_NEGATIVES)
def test_normalize_leaves_casual_chat_untouched(text: str):
    assert normalize_colloquial_create_verbs(text) == text


@pytest.mark.parametrize("text", CREATE_POSITIVES)
def test_suspected_media_create_positives(text: str):
    assert suspected_media_create(text) is True


@pytest.mark.parametrize("text", CASUAL_NEGATIVES)
def test_suspected_media_create_casual_negatives(text: str):
    assert suspected_media_create(text) is False


def test_suspected_vision_qa():
    assert suspected_vision_qa("这个图片是什么？") is True
    assert suspected_vision_qa("看看这张图") is True
    assert suspected_vision_qa("今天天气如何") is False


def test_media_directed_question_narrow():
    assert media_directed_question("这是什么？") is True
    assert media_directed_question("这是啥图") is True
    assert media_directed_question("看看") is True
    assert media_directed_question("今天天气如何") is False
    assert media_directed_question("生活怎么样") is False
    # create utterances stay on the create side
    assert media_directed_question("帮我弄张图看看") is False
