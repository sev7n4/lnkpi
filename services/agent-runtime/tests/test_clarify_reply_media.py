"""Natural-language aliases for media route clarification replies."""

from __future__ import annotations

import pytest

from app.graph.clarify_reply import classify_clarify_reply
from app.graph.route_precedence import ROUTE_CLARIFY_MEDIA


ORIGINAL_GENERATE = "请帮我生一个小女孩的图片"


@pytest.mark.parametrize("reply", ["生成一张图", "直接生成", "生图", "只要图"])
def test_clarify_reply_generate_alias_uses_original_prompt(reply: str):
    result = classify_clarify_reply(ORIGINAL_GENERATE, ROUTE_CLARIFY_MEDIA, reply)

    assert result != "none"
    assert result["route"] == "atomic_create"
    assert result["items"][0]["target_type"] == "image"
    assert result["items"][0]["prompt"] == ORIGINAL_GENERATE


def test_clarify_reply_choice_one_uses_original_prompt():
    result = classify_clarify_reply(ORIGINAL_GENERATE, ROUTE_CLARIFY_MEDIA, "1")

    assert result != "none"
    assert result["items"][0]["prompt"] == ORIGINAL_GENERATE


@pytest.mark.parametrize(
    "reply",
    ["解读侧栏图片", "解读侧栏", "看看图", "描述图片", "看图问答"],
)
def test_clarify_reply_interpret_sidebar_alias(reply: str):
    result = classify_clarify_reply(
        "这个图片是什么？", ROUTE_CLARIFY_MEDIA, reply
    )

    assert result != "none"
    assert result["route"] == "atomic_create"
    assert result["items"][0]["target_type"] == "text"
    assert result["items"][0]["prompt_mode"] == "vision_text"
