"""Unit tests for actionable gen copy."""

from __future__ import annotations

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary


def test_fallback_pending_line_guides_user():
    line = format_gen_progress_line(title="主图", status="fallback_pending")
    assert "待确认平台兜底" in line
    assert "画布" in line


def test_summary_includes_fallback_hint():
    text = format_gen_summary(
        lines=["· 主图：待确认平台兜底（请在画布节点上确认平台服务）"],
        success_n=1,
        fail_n=0,
        fallback_n=1,
    )
    assert "待确认平台兜底 1" in text
    assert "确认平台服务" in text
