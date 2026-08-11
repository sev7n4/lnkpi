"""UX-PV-05: scheme draft prose structure tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.graph.product_visual_v2.models import DialogDraftOutput
from app.graph.product_visual_v2.scheme_draft import (
    SCHEME_DRAFT_HEADINGS,
    normalize_macro_scheme_card,
    scheme_draft_has_four_sections,
)

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"
PROMPT_PATH = (
    SKILLS_DIR
    / "ecommerce-product-visual"
    / "assets"
    / "prompts"
    / "dialog-draft"
    / "1.0.0.md"
)

FOUR_SECTION_PROSE = """\
## 我理解您的需求
您需要巨峰葡萄礼盒的电商视觉，强调快递防压与送礼场景。

## 设计方向摘要
- 礼盒主视觉突出葡萄新鲜感
- 结构图展示防压内衬
- 手持场景强化送礼属性

## 完整方案说明
巨峰葡萄礼盒采用天地盖结构，外箱选用 EPE 缓冲与加固角，内托分格固定单串葡萄，避免运输磕碰。主视觉以深紫葡萄与绿叶形成食欲感，辅以手写体「鲜摘直达」强化品质感。场景图建议户外 picnic 与亲友赠礼两种构图，分别对应自用与送礼心智。

## 接下来请您
若下方有多套宏观风格卡片，请选择您偏好的方向后继续。
"""


@pytest.fixture
def fake_llm_output_fixture() -> str:
    return FOUR_SECTION_PROSE


def test_dialog_draft_prose_has_four_sections(fake_llm_output_fixture: str):
    for heading in SCHEME_DRAFT_HEADINGS:
        assert heading in fake_llm_output_fixture


def test_dialog_draft_prompt_requires_four_section_headings():
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    for heading in SCHEME_DRAFT_HEADINGS:
        assert heading in prompt


def test_scheme_draft_has_four_sections_helper():
    assert scheme_draft_has_four_sections(FOUR_SECTION_PROSE)
    assert not scheme_draft_has_four_sections("只有一段没有标题的正文。")


def test_dialog_draft_output_validates_four_sections():
    payload = {
        "draft_prose": FOUR_SECTION_PROSE,
        "macro_schemes": [{"id": "A", "label": "轻奢", "summary": "高端礼盒感"}],
        "visual_intent": {"primary_goal": "packaging_design"},
    }
    out = DialogDraftOutput.model_validate(payload)
    assert scheme_draft_has_four_sections(out.draft_prose)


def test_normalize_macro_scheme_card_truncates_summary_and_tags():
    card = normalize_macro_scheme_card(
        {
            "id": "A",
            "label": "红金礼盒",
            "summary": "x" * 100,
            "tags": ["#轻奢", "牛皮纸", "#轻奢"],
            "recommended": True,
            "recommend_reason": "契合节日氛围",
        }
    )
    assert len(card["summary"]) <= 80
    assert card["tags"] == ["轻奢", "牛皮纸"]
    assert card["recommend_reason"] == "契合节日氛围"
