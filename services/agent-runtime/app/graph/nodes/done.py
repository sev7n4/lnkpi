from __future__ import annotations

from typing import Callable

from langchain_core.messages import AIMessage


def make_done_node() -> Callable:
    async def done(state: dict) -> dict:
        completed = state.get("gen_completed") or []
        failed = state.get("gen_failed") or []
        if completed or failed:
            msg = f"流程结束。出图成功 {len(completed)}，失败 {len(failed)}。"
        else:
            msg = "拆解完成。出图编排将在后续步骤接入；你也可手动在画布上生成。"
        return {
            "phase": "done",
            "awaiting_user": False,
            "messages": [AIMessage(content=msg)],
        }

    return done
