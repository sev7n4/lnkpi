from __future__ import annotations

from typing import Any

# Cancel bookkeeping cleared once the next turn starts successfully.
CANCEL_STATE_CLEAR: dict[str, Any] = {
    "run_cancelled": None,
    "cancel_reason": None,
    "cancelled_from_phase": None,
}


def build_cancelled_checkpoint_update(
    *,
    completed_tasks: int = 0,
    total_tasks: int = 0,
    reason: str = "user",
    from_phase: str | None = None,
) -> dict[str, Any]:
    done = max(0, int(completed_tasks))
    total = max(done, int(total_tasks))
    if total > 0:
        progress = f"已停止出图（完成 {done}/{total}）。"
    else:
        progress = "已停止当前任务。"
    text = f"{progress}直接说修改意见，或点「发起新任务」。"
    origin = (from_phase or "").strip() or None
    return {
        "phase": "cancelled",
        # Keeps the pre-cancel phase so a later revise can tier its CLEAR table.
        "cancelled_from_phase": None if origin == "cancelled" else origin,
        "run_cancelled": True,
        "cancel_reason": reason or "user",
        "presentation": {
            "kind": "callout_info",
            "body": {"text": text},
        },
    }
