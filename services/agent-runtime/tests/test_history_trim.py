"""Tests for W17: History trimming logic."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from app.history_trim import estimate_tokens, trim_history
from app.runs import _trim_history


def test_trim_history_no_trim_needed():
    """When messages <= window, return all messages."""
    messages = [
        HumanMessage(content="Hello"),
        AIMessage(content="Hi there!"),
    ]
    result = _trim_history(messages, window=10)
    assert len(result) == 2
    assert result[0].content == "Hello"
    assert result[1].content == "Hi there!"


def test_trim_history_basic_trimming():
    """When messages > window, keep most recent N."""
    messages = [
        HumanMessage(content=f"Message {i}")
        for i in range(30)
    ]
    result = trim_history(messages, window=20, preserve_anchors=False)
    assert len(result) == 20
    assert result[0].content == "Message 10"
    assert result[-1].content == "Message 29"


def test_trim_history_preserves_first_user_anchor():
    messages = [HumanMessage(content="帮我做蓝牙耳机营销方案，品牌 lnkpi")]
    for i in range(25):
        messages.append(AIMessage(content=f"Reply {i}"))
        messages.append(HumanMessage(content=f"Follow up {i}"))

    result = trim_history(messages, window=20, preserve_anchors=True)
    assert result[0].content == "帮我做蓝牙耳机营销方案，品牌 lnkpi"
    assert len(result) <= 20
    assert result[-1].content == "Follow up 24"


def test_trim_history_preserves_plan_draft_anchor():
    messages = [
        HumanMessage(content="帮我做营销方案"),
        AIMessage(content="# 蓝牙耳机方案\n请确认是否按此方案拆解画布并出图"),
    ]
    for i in range(20):
        messages.append(HumanMessage(content=f"revise {i}"))
        messages.append(AIMessage(content=f"ok {i}"))

    result = trim_history(messages, window=10, preserve_anchors=True)
    assert result[0].content == "帮我做营销方案"
    assert "蓝牙耳机方案" in result[1].content
    assert len(result) <= 10


def test_trim_history_token_budget():
    long_body = "x" * 4000  # ~1000 tokens each
    messages = [
        HumanMessage(content=long_body),
        AIMessage(content=long_body),
        HumanMessage(content="latest user"),
        AIMessage(content="latest assistant"),
    ]
    result = trim_history(messages, window=10, token_budget=2500, preserve_anchors=False)
    assert len(result) >= 1
    assert result[-1].content == "latest assistant"
    total_tokens = sum(estimate_tokens(str(m.content)) for m in result)
    assert total_tokens <= 2500 + estimate_tokens("latest assistant")


def test_trim_history_window_size_variations():
    """Test different window sizes."""
    messages = [
        HumanMessage(content=f"Msg {i}")
        for i in range(50)
    ]

    result = trim_history(messages, window=5, preserve_anchors=False)
    assert len(result) == 5
    assert result[0].content == "Msg 45"
    assert result[-1].content == "Msg 49"

    result = trim_history(messages, window=1, preserve_anchors=False)
    assert len(result) == 1
    assert result[0].content == "Msg 49"

    result = trim_history(messages, window=100, preserve_anchors=False)
    assert len(result) == 50


def test_trim_history_preserves_order():
    """Ensure message order is preserved (most recent last)."""
    messages = [
        HumanMessage(content="First"),
        AIMessage(content="Second"),
        HumanMessage(content="Third"),
        AIMessage(content="Fourth"),
    ]
    result = trim_history(messages, window=2, preserve_anchors=False)
    assert len(result) == 2
    assert result[0].content == "Third"
    assert result[1].content == "Fourth"


def test_trim_history_empty_list():
    """Handle empty message list gracefully."""
    result = _trim_history([], window=10)
    assert len(result) == 0


def test_trim_history_exact_window_size():
    """When messages == window, return all without trimming."""
    messages = [
        HumanMessage(content=f"Msg {i}")
        for i in range(20)
    ]
    result = trim_history(messages, window=20, preserve_anchors=False)
    assert len(result) == 20
    assert result[0].content == "Msg 0"
    assert result[-1].content == "Msg 19"


def test_trim_history_real_world_scenario():
    """Test with realistic user/assistant conversation."""
    messages = [
        HumanMessage(content="I want to create a marketing plan"),
        AIMessage(content="Sure! Let me help you..."),
        HumanMessage(content="Make it more casual"),
        AIMessage(content="Got it! Here's a casual version..."),
        HumanMessage(content="Add more details to section 2"),
        AIMessage(content="Updated section 2 with more details..."),
        HumanMessage(content="Change the tone to professional"),
        AIMessage(content="Adjusted tone to professional..."),
    ]
    result = trim_history(messages, window=4, preserve_anchors=True)
    assert len(result) == 4
    assert result[0].content == "I want to create a marketing plan"
    assert result[-1].content == "Adjusted tone to professional..."
