from __future__ import annotations

from typing import Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary


def make_done_node() -> Callable:
    async def done(state: dict) -> dict:
        completed = state.get("gen_completed") or []
        failed = state.get("gen_failed") or []
        if completed or failed:
            lines: list[str] = []
            fallback_n = 0
            for item in failed:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or item.get("key") or "节点")
                reason = str(item.get("reason") or "failed")
                if reason.lower() == "fallback_pending":
                    fallback_n += 1
                lines.append(format_gen_progress_line(title=title, status=reason))
            for _ in completed:
                pass
            msg = format_gen_summary(
                lines=lines or ["（详见上方出图进度）"],
                success_n=len(completed),
                fail_n=len(failed),
                fallback_n=fallback_n,
            )
            msg = f"流程结束。\n{msg}"
        else:
            msg = "流程结束。本次无可汇总的出图结果；你也可手动在画布上生成。"

        # W5: interrupt_before 后不再需要 awaiting_user 判断
        # 如果当前 phase 是 await_copy_confirm，保持该 phase（等待用户确认主文案）
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
