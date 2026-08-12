"""Prompt policy tests for macro scheme count flexibility."""

from __future__ import annotations

from pathlib import Path


def test_dialog_draft_prompt_macro_count_policy():
    root = Path(__file__).resolve().parents[1]
    prompt = (
        root
        / "skills/ecommerce-product-visual/assets/prompts/dialog-draft/1.0.0.md"
    ).read_text(encoding="utf-8")
    assert "数量策略" in prompt
    assert "只输出 1 套" in prompt
    assert "禁止" in prompt and "微调版" in prompt
