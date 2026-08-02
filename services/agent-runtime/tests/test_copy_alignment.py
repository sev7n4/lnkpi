"""Tests for copy alignment harness and plan summary extraction."""

from __future__ import annotations

from app.graph.copy_alignment import (
    build_copy_writer_context,
    extract_anchor_terms,
    validate_copy_alignment,
)
from app.graph.nodes.plan._shared import plan_product_line, positioning_line, summarize

EARPHONE_PLAN = """# lnkpi 蓝牙耳机企业营销方案

## 2. 市场与竞争定位

### 2.1 市场背景

TWS 耳机市场已从功能竞争转向体验竞争。

| 参数 | 默认设定 |
|---|---|
| 产品品类 | TWS 真无线蓝牙耳机（含充电仓） |
| 品牌名称 | lnkpi（视觉统一为 LNKPI） |
"""

BLENDER_COPY = """# 破壁时代，重新定义一杯营养的浓度

## 市场背景：吃得饱 ≠ 吃得好

真正的好破壁机，不是转速堆砌。
"""

EARPHONE_COPY = """# lnkpi Buds Pro — 口袋里的澎湃声场

TWS 蓝牙耳机，主动降噪，长续航。
"""


def test_positioning_line_skips_section_number_heading():
    pos = positioning_line(EARPHONE_PLAN)
    assert pos != "2.1 市场背景"
    assert "TWS" in pos or "耳机" in pos


def test_summarize_uses_substantive_line_for_real_llm_plan():
    summary = summarize(EARPHONE_PLAN)
    assert "2.1 市场背景" not in summary or "TWS" in summary or "耳机" in summary


def test_plan_product_line_from_table():
    line = plan_product_line(EARPHONE_PLAN)
    assert "耳机" in line or "TWS" in line


def test_extract_anchor_terms_from_brief_and_plan():
    brief = "请帮我做一个蓝牙耳机ipod的营销方案，品牌lnkpi"
    terms = extract_anchor_terms(brief, EARPHONE_PLAN)
    assert any("lnkpi" in t.lower() for t in terms)
    assert any("耳机" in t for t in terms)


def test_validate_rejects_blender_copy_for_earphone_brief():
    brief = "请帮我做一个蓝牙耳机ipod的营销方案，品牌lnkpi"
    ok, reason = validate_copy_alignment(brief, EARPHONE_PLAN, BLENDER_COPY)
    assert ok is False
    assert reason is not None
    assert "不一致" in reason


def test_validate_accepts_aligned_copy():
    brief = "请帮我做一个蓝牙耳机ipod的营销方案，品牌lnkpi"
    ok, _ = validate_copy_alignment(brief, EARPHONE_PLAN, EARPHONE_COPY)
    assert ok is True


def test_build_copy_writer_context_includes_brief_and_plan():
    ctx = build_copy_writer_context(
        user_brief="请帮我做一个蓝牙耳机ipod的营销方案，品牌lnkpi",
        plan_draft=EARPHONE_PLAN,
        plan_summary="2.1 市场背景",
        hint="主文案节点",
    )
    assert "用户需求锚定" in ctx
    assert "lnkpi" in ctx
    assert "TWS" in ctx or "蓝牙耳机" in ctx
    assert "2.1 市场背景" in ctx  # summary is supplementary


LATEX_COPY = """# 天然乳胶枕，让每夜深睡如云

## 产品类别：天然乳胶寝具
本产品通过天猫官方旗舰店、京东自营等主流电商平台直接销售。
"""


def test_validate_rejects_latex_copy_for_earphone_brief():
    brief = "请帮我做一个lnkpi蓝牙耳机营销方案"
    ok, reason = validate_copy_alignment(brief, EARPHONE_PLAN, LATEX_COPY)
    assert ok is False
    assert reason is not None


def test_validate_rejects_when_brief_and_plan_missing():
    ok, reason = validate_copy_alignment("", "", "任意正文")
    assert ok is False
    assert reason is not None
    assert "上下文" in reason or "方案" in reason


def test_validate_rejects_misaligned_even_with_channel_keywords():
    """Generic 天猫/京东 overlap must not pass without brand/product anchors."""
    brief = "请帮我做一个lnkpi蓝牙耳机营销方案"
    copy = "天猫旗舰店京东自营官方正品销售"
    ok, _ = validate_copy_alignment(brief, EARPHONE_PLAN, copy)
    assert ok is False
