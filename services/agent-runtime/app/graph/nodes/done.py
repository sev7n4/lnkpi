from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_summary
from app.graph.gen_progress_read import load_gen_progress, parse_gen_progress_record
from app.graph.product_visual_v2.delivery import build_done_presentation
from app.graph.product_visual_v2.errors import build_error_presentation, format_flow_end_message
from app.graph.product_visual_v2.routing import is_v2_enabled


def make_done_node(*, nest: Any = None) -> Callable:
    async def done(state: dict) -> dict:
        flow_mode = state.get("flow_mode")
        if flow_mode in ("atomic_create", "atomic_regenerate"):
            return {"phase": "done", "messages": []}

        if flow_mode == "product_visual" and is_v2_enabled(state):
            if state.get("shot_manifest") and state.get("delivery_selections"):
                presentation = build_done_presentation(state)
                headline = str((presentation.get("body") or {}).get("headline") or "✅ 视觉稿已就绪")
                return {
                    "phase": "done",
                    "presentation": presentation,
                    "messages": [AIMessage(content=headline)],
                }
            if state.get("last_error"):
                presentation = build_error_presentation(state)
                msg = format_flow_end_message(str(state["last_error"]), state)
                return {
                    "phase": "done",
                    "presentation": presentation,
                    "messages": [AIMessage(content=msg)],
                }

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
        elif state.get("last_error"):
            msg = format_flow_end_message(str(state["last_error"]), state)
        else:
            msg = "本次无可汇总的出图结果；你也可手动在画布上生成。"

        out: dict[str, Any] = {
            "phase": "done",
            "messages": [AIMessage(content=msg)],
        }
        if flow_mode == "product_visual" and is_v2_enabled(state) and state.get("last_error"):
            out["presentation"] = build_error_presentation(state)

        if state.get("phase") == "await_copy_confirm":
            return {
                "phase": "await_copy_confirm",
                "messages": [AIMessage(content=msg)],
            }
        return out

    return done
