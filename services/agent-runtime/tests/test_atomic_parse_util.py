"""P4-04: atomic parse few-shot and prompt extraction tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.graph.atomic_intent import atomic_create_intent
from app.graph.atomic_parse_util import (
    build_atomic_spec_enriched,
    dedupe_atomic_title,
    extract_atomic_prompt,
    format_canvas_context_line,
    load_atomic_parse_few_shots,
    parse_few_shot_json,
)

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


def test_confirm_gen_not_atomic_create():
    assert not atomic_create_intent("确认出图")
    assert not atomic_create_intent("开始出图")


def test_extract_atomic_prompt_strips_prefix():
    assert extract_atomic_prompt("帮我生成一个模特人物图") == "模特人物图"
    assert extract_atomic_prompt("写一段天猫详情页开场文案") == "天猫详情页开场文案"


def test_parse_atomic_multi_items_three_images():
    from app.graph.atomic_parse_util import parse_atomic_multi_items

    utterance = "帮我生成三张图，分别是蓝牙耳机主图、白底图、三视图。"
    items = parse_atomic_multi_items(utterance)
    assert items is not None
    assert len(items) == 3
    assert items[0]["prompt"] == "蓝牙耳机主图"
    assert items[1]["prompt"] == "白底图"
    assert items[2]["prompt"] == "三视图"


def test_parse_atomic_multi_items_not_single_image():
    from app.graph.atomic_parse_util import parse_atomic_multi_items

    assert parse_atomic_multi_items("帮我生成一个模特人物图") is None


def test_build_atomic_spec_enriched_uses_clean_prompt():
    spec = build_atomic_spec_enriched("帮我生成一个模特人物图")
    assert spec["target_type"] == "image"
    assert spec["prompt"] == "模特人物图"


def test_build_atomic_spec_dedupes_title_from_canvas():
    summary = {
        "nodes": [
            {"id": "n1", "type": "image", "title": "模特人物图", "status": "completed"},
        ]
    }
    spec = build_atomic_spec_enriched("帮我生成一个模特人物图", canvas_summary=summary)
    assert spec["title"] == "模特人物图 (2)"
    assert "canvas_context" in spec


def test_build_atomic_spec_focus_seed_for_prompt_expand():
    summary = {
        "nodes": [
            {"id": "hero-1", "type": "image", "title": "主图", "status": "completed"},
        ]
    }
    spec = build_atomic_spec_enriched(
        "多模式扩写这个主图 prompt",
        canvas_summary=summary,
        focus_node_id="hero-1",
    )
    assert spec["target_type"] == "prompt"
    assert "主图" in spec["prompt"]


def test_format_canvas_context_line():
    line = format_canvas_context_line(
        [
            {"type": "image", "title": "主图"},
            {"type": "text", "title": "主文案"},
        ]
    )
    assert "2 节点" in line
    assert "image×1" in line
    assert "主图" in line


def test_dedupe_atomic_title():
    nodes = [{"title": "Banner"}, {"title": "Banner (2)"}]
    assert dedupe_atomic_title("Banner", nodes) == "Banner (3)"


def test_parse_few_shot_json_roundtrip():
    raw = '{"target_type":"video","prompt":"15秒产品展示","title":"产品视频","confirm_gate":true}'
    parsed = parse_few_shot_json(raw)
    assert parsed is not None
    assert parsed["target_type"] == "video"
    assert parsed["confirm_gate"] is True


def test_load_atomic_parse_few_shots():
    pairs = load_atomic_parse_few_shots(SKILLS_DIR)
    assert len(pairs) >= 3
    for user, assistant in pairs:
        assert user.strip()
        assert parse_few_shot_json(assistant) is not None
