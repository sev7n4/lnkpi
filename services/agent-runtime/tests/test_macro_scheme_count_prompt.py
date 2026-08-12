"""Prompt policy tests for macro scheme count flexibility."""

from __future__ import annotations

from pathlib import Path


def test_dialog_draft_prompt_macro_count_policy():
    root = Path(__file__).resolve().parents[1]
    prompt = (
        root
        / "skills/ecommerce-product-visual/assets/prompts/dialog-draft/1.0.0.md"
    ).read_text(encoding="utf-8")
    assert "1~4" in prompt or "1~4 个" in prompt
    assert "自动选中" in prompt
    assert "A/B/C/D" in prompt
