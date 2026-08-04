from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_summary
from app.graph.gen_progress_read import load_gen_progress, parse_gen_progress_record


def make_done_node(*, nest: Any = None) -> Callable:
    async def done(state: dict) -> dict:
        flow_mode = state.get("flow_mode")
        if flow_mode in ("atomic_create", "atomic_regenerate"):
            return {"phase": "done", "messages": []}

        thread_id = str(state.get("thread_id") or "")
        progress = await load_gen_progress(nest, thread_id) if state.get("gen_progress_id") else None

        if progress:
            lines, success_n, fail_n, fallback_n = parse_gen_progress_record(progress)
            msg = format_gen_summary(
                lines=lines or ["（详见上方出图进度）"],
                success_n=success_n,
                fail_n=fail_n,
                fallback_n=fallback_n,
            )
            msg = f"流程结束。\n{msg}"
        elif state.get("last_error"):
            msg = f"流程结束。{state['last_error']}"
        else:
            msg = "流程结束。本次无可汇总的出图结果；你也可手动在画布上生成。"

        if state.get("phase") == "await_copy_confirm":
            return {
                "phase": "await_copy_confirm",
                "messages": [AIMessage(content=msg)],
            }
        return {
            "phase": "done",
            "messages": [AIMessage(content=msg)],
        }

    return done
