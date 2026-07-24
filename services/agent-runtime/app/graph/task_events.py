"""Helpers for structured task_progress SSE payloads and retry classification."""

from __future__ import annotations

_NON_RECOVERABLE = (
    "fallback_pending",
    "insufficient",
    "积分不足",
    "points",
    "policy",
    "审核",
    "content_policy",
    "forbidden",
    "unauthorized",
)

_HINTS: dict[str, str] = {
    "fallback_pending": "请到画布对应节点确认平台服务后继续",
    "insufficient": "请充值或更换可用渠道后再试",
    "points": "请充值或更换可用渠道后再试",
    "积分不足": "请充值或更换可用渠道后再试",
    "timeout": "可稍后在节点上点重试，或换模型再试",
    "5xx": "可稍后在节点上点重试，或换模型再试",
    "policy": "请改提示词后在节点重试",
    "审核": "请改提示词后在节点重试",
    "content_policy": "请改提示词后在节点重试",
    "dep_failed": "先修复上游节点再重试本项",
}


def is_recoverable(status_or_error: str | None) -> bool:
    """False for fallback_pending / credits / policy; True for transient failures."""
    raw = (status_or_error or "").strip().lower()
    if not raw:
        return True
    for token in _NON_RECOVERABLE:
        if token.lower() in raw:
            return False
    return True


def hint_for_error(code_or_status: str | None) -> str:
    raw = (code_or_status or "").strip()
    lowered = raw.lower()
    for key, hint in _HINTS.items():
        if key.lower() in lowered:
            return hint
    return "打开节点「诊断信息」查看详情后重试"


def max_auto_retries() -> int:
    """Spec: auto-retry at most 2 times (3 total attempts)."""
    return 2
