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


def test_extract_atomic_prompt_preserves_audio_vo_utterance():
    utterance = "给这段文案配一段旁白"
    assert extract_atomic_prompt(utterance) == utterance


def test_rule_parse_audio_vo_reaches_confirm_gate_confidence():
    from app.graph.atomic_parse_util import rule_parse_atomic
    from app.graph.atomic_parse_schema import outcome_from_rule_items

    items, conf = rule_parse_atomic("给这段文案配一段旁白")
    assert items[0]["target_type"] == "audio"
    assert items[0]["confirm_gate"] is True
    assert conf >= 0.95
    outcome = outcome_from_rule_items(items, confidence=conf)
    assert outcome["kind"] == "success"


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


def test_parse_atomic_multi_items_color_variants_with_ref():
    from app.graph.atomic_parse_util import parse_atomic_multi_items

    utterance = "@I1 ，参考这个图，生成7中不同颜色的7张图"
    items = parse_atomic_multi_items(utterance)
    assert items is not None
    assert len(items) == 7
    assert all(i["target_type"] == "image" for i in items)
    assert "变体 1/7" in items[0]["prompt"]


def test_atomic_create_intent_batch_image_count():
    from app.graph.atomic_intent import atomic_create_intent

    assert atomic_create_intent("@I1 ，参考这个图，生成7中不同颜色的7张图")
    assert atomic_create_intent("生成3张场景图")
    assert not atomic_create_intent("今天天气不错")


def test_intake_routes_batch_color_variants_to_atomic():
    from app.graph.nodes.intake import make_intake_node
    from langchain_core.messages import HumanMessage
    from pathlib import Path

    skills_dir = Path(__file__).resolve().parents[1] / "skills"
    intake = make_intake_node(skills_dir)
    utterance = "@I1 ，参考这个图，生成7中不同颜色的7张图"

    import asyncio

    out = asyncio.get_event_loop().run_until_complete(
        intake({"messages": [HumanMessage(content=utterance)]})
    )
    assert out["flow_mode"] == "atomic_create"


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


def test_build_atomic_spec_style_inherit_from_context():
    messages_ctx = "近期对话:用户:赛博朋克耳机主图→助手:已创建"
    spec = build_atomic_spec_enriched(
        "同样风格帮我生成一张主图",
        parse_context=messages_ctx,
    )
    assert "赛博朋克耳机主图" in spec["prompt"]


def test_build_variant_spec_dedupes_title_for_new_node():
    from app.graph.atomic_parse_util import build_variant_spec_from_checkpoint

    prior = {"target_type": "image", "title": "模特图", "prompt": "模特人物图", "confirm_gate": False}
    summary = {"nodes": [{"id": "node-abc", "type": "image", "title": "模特图"}]}
    spec = build_variant_spec_from_checkpoint(
        "重新生成一张，背景改成白色",
        prior,
        canvas_summary=summary,
    )
    assert spec["title"] == "模特图 (2)"
    assert "背景改成白色" in spec["prompt"]


def test_build_variant_spec_style_from_context():
    from app.graph.atomic_parse_util import build_variant_spec_from_checkpoint

    prior = {"target_type": "image", "title": "模特图", "prompt": "模特人物图", "confirm_gate": False}
    ctx = "近期对话:用户:赛博朋克耳机主图→助手:已创建"
    spec = build_variant_spec_from_checkpoint(
        "按刚才那个风格再生成一张",
        prior,
        parse_context=ctx,
    )
    assert "赛博朋克耳机主图" in spec["prompt"]


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
    assert len(pairs) >= 20
    for user, assistant in pairs:
        assert user.strip()
        # Phase 2 few-shots use full structured JSON; legacy single-spec still valid
        assert assistant.strip().startswith("{")


def test_rule_confidence_capped_for_planning_conflict():
    from app.graph.atomic_parse_util import rule_parse_confidence

    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    spec = {"target_type": "image", "prompt": u}
    assert rule_parse_confidence(u, spec, None) <= 0.65


def test_rule_confidence_unchanged_for_explicit_generate():
    from app.graph.atomic_parse_util import rule_parse_confidence

    u = "生成一张蓝牙耳机主图"
    spec = {"target_type": "image", "prompt": u}
    assert rule_parse_confidence(u, spec, None) == 0.96
