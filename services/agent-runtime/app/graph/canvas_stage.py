"""W8 canvas stage/commit helpers (P0-08).

Nest accumulates staged actions in ``Session.stagedActions`` and applies them
on ``commitStage``. Pending stages block direct ``persist`` calls.

Nest auto-discards stages older than ``STAGE_TTL_MS`` (30 minutes) on the next
commit/persist attempt — see ``agent-canvas-tools.service.ts``.
"""

from __future__ import annotations

from typing import Any


async def rollback_stage_safe(nest: Any) -> bool:
    """Discard pending staged canvas actions. Returns True if rollback ran."""
    fn = getattr(nest, "rollback_stage", None)
    if fn is None:
        return False
    try:
        result = await fn()
        return bool(result.get("cleared", True))
    except Exception:  # noqa: BLE001 — rollback must not crash the graph
        return False


async def commit_stage_or_rollback(nest: Any) -> tuple[bool, str | None]:
    """Commit staged actions; on failure rollback and return ``(False, err)``."""
    commit_fn = getattr(nest, "commit_stage", None)
    if commit_fn is None:
        return True, None
    try:
        await commit_fn()
        return True, None
    except Exception as exc:  # noqa: BLE001
        await rollback_stage_safe(nest)
        return False, str(exc)


def stage_failure_message(context: str, exc: BaseException) -> str:
    return f"{context}失败，已回滚暂存变更：{exc}。请重试或说明修改。"
