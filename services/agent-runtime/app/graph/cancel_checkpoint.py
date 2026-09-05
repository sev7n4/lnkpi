from __future__ import annotations

from typing import Any


def build_cancelled_checkpoint_update(
    *,
    completed_tasks: int = 0,
    total_tasks: int = 0,
    reason: str = "user",
) -> dict[str, Any]:
    done = max(0, int(completed_tasks))
    total = max(done, int(total_tasks))
    if total > 0:
        progress = f"已停止出图（完成 {done}/{total}）。"
    else:
        progress = "已停止当前任务。"
    text = f"{progress}直接说修改意见，或点「发起新任务」。"
    return {
        "phase": "cancelled",
        "run_cancelled": True,
        "cancel_reason": reason or "user",
        "presentation": {
            "kind": "callout_info",
            "body": {"text": text},
        },
    }
