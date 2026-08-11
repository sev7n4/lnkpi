"""Helpers for structured task_progress SSE payloads and retry classification."""

from __future__ import annotations

from app.errors import (
    error_type_from_status,
    is_recoverable_error_type,
    retry_hint_for_type,
)

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
    "tool_timeout": "可稍后在节点上点重试，或换模型再试",
    "5xx": "可稍后在节点上点重试，或换模型再试",
    "downstream_unavailable": "可稍后在节点上点重试，或换模型再试",
    "circuit_open": "服务繁忙，请稍后再试",
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
    typed = error_type_from_status(raw)
    if typed in ("param_error", "permission_denied"):
        return False
    if typed in ("tool_timeout", "downstream_unavailable", "circuit_open", "internal_error"):
        return is_recoverable_error_type(typed)
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
    typed = error_type_from_status(raw)
    return retry_hint_for_type(typed)


def max_auto_retries() -> int:
    """Spec: auto-retry at most 2 times (3 total attempts)."""
    return 2


def build_task_list_items(
    manifest: list[dict],
    ordered_keys: list[str] | None = None,
) -> list[dict[str, str]]:
    """Build ``task_list`` SSE items with human-readable (Chinese) titles."""
    by_key = {
        str(it["key"]): it
        for it in manifest
        if isinstance(it, dict) and it.get("key")
    }
    keys = ordered_keys if ordered_keys else list(by_key.keys())
    items: list[dict[str, str]] = []
    for key in keys:
        item = by_key.get(key)
        if not item:
            continue
        items.append(
            {
                "id": key,
                "title": str(item.get("title") or key),
                "nodeId": str(item.get("node_id") or ""),
                "kind": str(item.get("target_type") or "image"),
            }
        )
    return items
