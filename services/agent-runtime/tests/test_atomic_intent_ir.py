"""Tests for structured Atomic Intent IR."""

from __future__ import annotations

from app.graph.atomic_intent import build_atomic_spec, parse_atomic_target_type
from app.graph.atomic_intent_ir import (
    derive_studio_prompt,
    is_prompt_expand_intent,
    is_source_backed_media_generation,
    resolve_atomic_intent,
    resolve_output_modality,
)
from app.graph.atomic_parse_util import rule_parse_atomic


def test_source_backed_video_from_prompt_word():
    u = "基于提示词生成视频"
    assert is_source_backed_media_generation(u)
    assert not is_prompt_expand_intent(u)
    assert resolve_output_modality(u) == "video"
    assert parse_atomic_target_type(u) == "video"
    spec = build_atomic_spec(u)
    assert spec["target_type"] == "video"
    assert spec["prompt"] == "基于引用内容生成视频"
    assert spec["confirm_gate"] is True


def test_ref_copy_video_with_t1():
    u = "@T1 请基于文案生成视频"
    assert resolve_output_modality(u, mentioned_keys=["T1"]) == "video"
    spec = build_atomic_spec(u, mentioned_keys=["T1"])
    assert spec["target_type"] == "video"
    assert spec["prompt"] == "基于引用内容生成视频"


def test_source_backed_image():
    u = "基于文本生成图片"
    assert resolve_output_modality(u) == "image"
    spec = build_atomic_spec(u)
    assert spec["target_type"] == "image"
    assert "图片" in spec["prompt"] or "引用" in spec["prompt"]


def test_storyboard_prompt_still_prompt():
    u = "帮我生成一个蓝牙耳机的分镜提示词"
    assert is_prompt_expand_intent(u)
    assert parse_atomic_target_type(u) == "prompt"


def test_prompt_mode_expand_still_prompt():
    u = "用提示词模式扩写：赛博朋克耳机主图"
    assert parse_atomic_target_type(u) == "prompt"


def test_pure_script_still_text():
    u = "生成蓝牙耳机的分镜脚本，5个镜头"
    assert parse_atomic_target_type(u) == "text"


def test_rule_parse_conflict_capped_below_fast_path():
    items, conf = rule_parse_atomic("基于提示词生成视频")
    assert items[0]["target_type"] == "video"
    assert conf < 0.95


def test_derive_studio_prompt_plain_utterance():
    intent = resolve_atomic_intent("帮我做一个15秒产品展示视频")
    assert derive_studio_prompt(intent) == "帮我做一个15秒产品展示视频"
