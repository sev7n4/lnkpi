"""P4-04: atomic parse few-shot and prompt extraction tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.graph.atomic_intent import atomic_create_intent
from app.graph.atomic_parse_util import (
    build_atomic_spec_enriched,
    extract_atomic_prompt,
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


def test_build_atomic_spec_enriched_uses_clean_prompt():
    spec = build_atomic_spec_enriched("帮我生成一个模特人物图")
    assert spec["target_type"] == "image"
    assert spec["prompt"] == "模特人物图"


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
