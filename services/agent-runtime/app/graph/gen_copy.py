"""Helpers for actionable generation result copy."""

from __future__ import annotations


def format_gen_progress_line(*, title: str, status: str) -> str:
    st = (status or "").lower()
    if st in ("completed", "success", "ok"):
        return f"· {title}：出图成功"
    # 修复 P1-5：fallback_pending 不再生成「请在画布节点上确认平台服务」提示语
    # 这条消息会通过 emit_line 推到 AI 助手聊天，和前端 ByokFallbackConfirmDialog 重复
    # 统一由画布 dialog 通道承担用户确认入口
    if st == "fallback_pending":
        return f"· {title}：待确认平台兜底"
    if st in ("cancelled", "canceled"):
        return f"· {title}：已取消"
    return f"· {title}：失败（{status or 'error'}）"


def format_gen_summary(
    *,
    lines: list[str],
    success_n: int,
    fail_n: int,
    fallback_n: int,
) -> str:
    # 修复 P1-5：去掉「请到画布对应节点点击确认平台服务后继续出图」重复提示
    # 渠道回退确认只走画布 ByokFallbackConfirmDialog，不在聊天中重复
    parts = [
        "自动出图汇总：",
        *lines,
        f"合计：成功 {success_n}，失败/跳过 {fail_n}"
        + (f"，待确认平台兜底 {fallback_n}" if fallback_n else "")
        + "。",
    ]
    return "\n".join(parts)
