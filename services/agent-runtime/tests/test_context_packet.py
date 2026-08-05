"""ContextPacket build + render tests."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from app.graph.atomic_context import build_atomic_parse_context
from app.graph.context_packet import (
    build_parse_packet,
    explore_summary_from_packet,
    should_include_episodic,
    should_include_prior_task,
)
from app.graph.context_render import render_packet_for_llm


def test_topic_switch_drops_prior_and_episodic():
    state = {
        "messages": [
            HumanMessage(content="帮我拟定蓝牙耳机三视图 prompt"),
            AIMessage(content="好的，我来生成提示词「蓝牙耳机三视图」。"),
            HumanMessage(content="帮我生成一个山海经的神兽的三视图"),
        ],
        "atomic_spec": {
            "target_type": "prompt",
            "title": "蓝牙耳机三视图 prompt",
            "prompt": "蓝牙耳机",
        },
    }
    summary = {
        "nodes": [
            {"id": "n1", "type": "prompt", "title": "蓝牙耳机 prompt"},
            {"id": "n2", "type": "image", "title": "主图"},
        ]
    }
    packet = build_parse_packet(state, canvas_summary=summary)
    assert should_include_prior_task("帮我生成一个山海经的神兽的三视图", state["atomic_spec"]) is False
    assert should_include_episodic("帮我生成一个山海经的神兽的三视图", state["atomic_spec"]) is False
    assert packet.get("meta", {}).get("topic_switch") is True
    assert "episodic" not in packet
    rendered = render_packet_for_llm(packet)
    assert "山海经" in rendered
    assert "蓝牙耳机" not in rendered
    assert "近期" not in rendered
    assert "勿继承" in rendered or "无关" in rendered


def test_style_inherit_includes_episodic():
    state = {
        "messages": [
            HumanMessage(content="山海经神兽三视图"),
            AIMessage(content="「山海经神兽三视图」生成完成，请在画布查看节点。"),
            HumanMessage(content="按刚才那个风格，再生成一张赛博朋克版主图"),
        ],
        "atomic_spec": {
            "target_type": "image",
            "title": "山海经神兽三视图",
        },
    }
    utterance = "按刚才那个风格，再生成一张赛博朋克版主图"
    assert should_include_prior_task(utterance, state["atomic_spec"]) is True
    assert should_include_episodic(utterance, state["atomic_spec"]) is True
    packet = build_parse_packet(state, canvas_summary={"nodes": []}, utterance=utterance)
    assert packet.get("episodic")
    rendered = render_packet_for_llm(packet)
    assert "## 近期" in rendered
    assert "style_inherit" in rendered or "prior" in rendered


def test_focus_node_in_canvas_packet():
    state = {
        "messages": [HumanMessage(content="快速生成")],
        "focus_node_id": "n-8",
    }
    summary = {
        "nodes": [
            {"id": "n-8", "type": "image", "title": "白底图", "data": {"prompt": "纯白背景"}},
            {"id": "n-9", "type": "image", "title": "主图"},
        ]
    }
    packet = build_parse_packet(state, canvas_summary=summary)
    canvas = packet.get("canvas") or {}
    assert canvas.get("selected_node", {}).get("id") == "n-8"
    rendered = render_packet_for_llm(packet)
    assert "白底图" in rendered
    assert "选中" in rendered


def test_build_atomic_parse_context_uses_markdown_not_legacy_pipe():
    ctx = build_atomic_parse_context(
        {
            "messages": [HumanMessage(content="生成一张主图")],
            "atomic_spec": {"title": "旧任务", "target_type": "image"},
        },
        canvas_summary={"nodes": [{"id": "n1", "type": "image", "title": "旧任务"}]},
    )
    assert " | " not in ctx
    assert "上轮原子" not in ctx
    assert "##" in ctx


def test_explore_summary_from_packet_no_raw_context():
    packet = build_parse_packet(
        {
            "messages": [HumanMessage(content="生成一张主图")],
        },
        canvas_summary={
            "nodes": [
                {"id": "n1", "type": "image", "title": "主图参考"},
                {"id": "n2", "type": "prompt", "title": "文案"},
            ],
        },
    )
    summary = explore_summary_from_packet(packet)
    assert summary["label"] == "参考画布上下文"
    assert summary["nodeCount"] >= 1
    assert "[canvas_context]" not in str(summary)
