from __future__ import annotations

from typing import Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary


def make_done_node() -> Callable:
    async def done(state: dict) -> dict:
        completed = state.get("gen_completed") or []
        failed = state.get("gen_failed") or []
        if state.get("pending_orchestrate") and not completed and not failed:
            msg = (
                "主文案草稿已就绪；图片/视频正在后台生成。"
                "可先确认「写入主文案」，无需等待出图结束。"
            )
        elif completed or failed:
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
                pass  # per-node success already streamed in orchestrate_gen
            msg = format_gen_summary(
                lines=lines or ["（详见上方出图进度）"],
                success_n=len(completed),
                fail_n=len(failed),
                fallback_n=fallback_n,
            )
            msg = f"流程结束。\n{msg}"
        else:
            msg = "流程结束。本次无可汇总的出图结果；你也可手动在画布上生成。"
        if state.get("phase") == "await_copy_confirm" or (
            state.get("awaiting_user") and state.get("copy_draft")
        ):
            return {
                "phase": "await_copy_confirm",
                "awaiting_user": True,
                "pending_orchestrate": False,
                "messages": [AIMessage(content=msg)],
            }
        return {
            "phase": "done",
            "awaiting_user": False,
            "pending_orchestrate": False,
            "messages": [AIMessage(content=msg)],
        }

    return done
