"""Unit tests for actionable gen copy."""

from __future__ import annotations

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary


def test_fallback_pending_line_is_concise():
    # 修复 P1-5：fallback_pending 行不再携带"请在画布节点上确认平台服务"
    # 这条提示只由画布 ByokFallbackConfirmDialog 通道承担，避免与聊天消息重复
    line = format_gen_progress_line(title="主图", status="fallback_pending")
    assert "待确认平台兜底" in line
    assert "画布节点" not in line
    assert "确认平台服务" not in line


def test_summary_omits_canvas_dialog_hint():
    # 修复 P1-5：汇总不再追加"请到画布对应节点点击确认平台服务后继续出图"
    # 渠道回退确认只走画布 dialog，不再在聊天汇总里重复
    text = format_gen_summary(
        lines=["· 主图：待确认平台兜底"],
        success_n=1,
        fail_n=0,
        fallback_n=1,
    )
    assert "待确认平台兜底 1" in text
    assert "请到画布对应节点" not in text
    assert "点击确认平台服务" not in text
