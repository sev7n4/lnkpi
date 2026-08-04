"""Phase 3: atomic parse context assembly tests."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from app.graph.atomic_context import build_atomic_parse_context, summarize_recent_turns


def test_summarize_recent_turns_last_two():
    messages = [
        HumanMessage(content="帮我生成模特图"),
        AIMessage(content="已创建 image 节点"),
        HumanMessage(content="重新生成一张"),
        AIMessage(content="正在重新生成"),
        HumanMessage(content="背景改成白色"),
        AIMessage(content="完成"),
    ]
    summary = summarize_recent_turns(messages, max_turns=2)
    assert "重新生成一张" in summary
    assert "背景改成白色" in summary
    assert "帮我生成模特图" not in summary


def test_build_atomic_parse_context_respects_max_length():
    long_user = "A" * 400
    messages = [
        HumanMessage(content=long_user),
        AIMessage(content="ok"),
        HumanMessage(content="B" * 400),
        AIMessage(content="ok2"),
    ]
    ctx = build_atomic_parse_context({"messages": messages}, max_chars=500)
    assert len(ctx) <= 500
    assert ctx.endswith("…") or len(ctx) <= 500


def test_build_atomic_parse_context_includes_canvas_and_history():
    summary = {
        "nodes": [
            {"id": "n1", "type": "image", "title": "主图"},
        ]
    }
    messages = [
        HumanMessage(content="帮我生成主图"),
        AIMessage(content="主图已创建"),
    ]
    ctx = build_atomic_parse_context({"messages": messages}, canvas_summary=summary)
    assert "画布" in ctx
    assert "主图" in ctx
    assert "近期对话" in ctx
