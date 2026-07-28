"""Tests for W17: History trimming logic."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

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
    result = _trim_history(messages, window=20)
    assert len(result) == 20
    # Should keep messages 10-29 (most recent 20)
    assert result[0].content == "Message 10"
    assert result[-1].content == "Message 29"


def test_trim_history_window_size_variations():
    """Test different window sizes."""
    messages = [
        HumanMessage(content=f"Msg {i}")
        for i in range(50)
    ]

    # Window = 5
    result = _trim_history(messages, window=5)
    assert len(result) == 5
    assert result[0].content == "Msg 45"
    assert result[-1].content == "Msg 49"

    # Window = 1
    result = _trim_history(messages, window=1)
    assert len(result) == 1
    assert result[0].content == "Msg 49"

    # Window = 100 (larger than messages)
    result = _trim_history(messages, window=100)
    assert len(result) == 50


def test_trim_history_preserves_order():
    """Ensure message order is preserved (most recent last)."""
    messages = [
        HumanMessage(content="First"),
        AIMessage(content="Second"),
        HumanMessage(content="Third"),
        AIMessage(content="Fourth"),
    ]
    result = _trim_history(messages, window=2)
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
    result = _trim_history(messages, window=20)
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
    # Keep last 4 messages (window=4)
    result = _trim_history(messages, window=4)
    assert len(result) == 4
    # Should keep messages 4-7 (index)
    assert result[0].content == "Add more details to section 2"
    assert result[-1].content == "Adjusted tone to professional..."