"""Collect generation results: aggregate, emit summary, persist GenProgress (W15).

Reads the W3 Send-API accumulators (``gen_completed_keys`` / ``gen_failed_keys``
/ ``gen_needs_user_keys`` / ``gen_fail_details``) and:
  - emits a task_summary + per-line progress to the chat/canvas stream,
  - persists progress to the GenProgress table (W15),
  - clears all W3 transient fields so the next generation run starts clean.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary
from app.graph.gen_run_state import clear_tier_b_gen_run_state
from app.graph.task_events import hint_for_error


async def _emit_task_summary(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_summary", None)
    if fn is not None:
        await fn(**payload)


async def _emit_text(nest: Any, text: str) -> None:
    fn = getattr(nest, "emit_text", None)
    if fn is not None:
        await fn(text if text.endswith("\n") else text + "\n")


def make_collect_gen_node(*, nest: Any) -> Callable:
    async def collect_gen(state: dict) -> dict:
        completed_keys: set[str] = set(state.get("gen_completed_keys") or [])
        failed_keys: set[str] = set(state.get("gen_failed_keys") or [])
        needs_user_keys: set[str] = set(state.get("gen_needs_user_keys") or [])
        details: dict[str, dict] = state.get("gen_fail_details") or {}
        by_key: dict[str, dict] = state.get("gen_by_key") or {}
        ordered_keys: list[str] = list(state.get("gen_ordered_keys") or [])

        thread_id = state.get("thread_id", "")
        session_id = state.get("session_id", "")

        progress_lines: list[str] = []
        summary_lines: list[dict[str, str]] = []
        fallback_n = 0
        needs_user_n = 0  # self-needs-user (fallback_pending / non-recoverable), excludes skipped
        skipped_n = 0  # dependency_skipped (upstream needs_user → downstream recoverable)
        success_n = 0

        for key in ordered_keys:
            item = by_key.get(key, {})
            node_id = str(item.get("node_id") or key)
            title = str(item.get("title") or key)
            reason = str((details.get(key) or {}).get("reason") or "")
            reason_lower = reason.lower()

            if key in completed_keys:
                success_n += 1
                line = format_gen_progress_line(title=title, status="completed")
                progress_lines.append(line)
                await _emit_text(nest, line)
            elif key in needs_user_keys:
                if reason == "dependency_skipped":
                    skipped_n += 1
                else:
                    needs_user_n += 1
                    if reason_lower == "fallback_pending":
                        fallback_n += 1
                summary_lines.append(
                    {"id": key, "status": "needs_user", "title": title, "hint": hint_for_error(reason)}
                )
                line = format_gen_progress_line(title=title, status=reason)
                progress_lines.append(line)
                # P1-5: fallback_pending 不向聊天流 emit 单行（走画布确认弹窗）
                if reason_lower != "fallback_pending":
                    await _emit_text(nest, line)
            elif key in failed_keys:
                summary_lines.append(
                    {"id": key, "status": "failed", "title": title, "hint": hint_for_error(reason)}
                )
                line = format_gen_progress_line(title=title, status=reason or "failed")
                progress_lines.append(line)
                await _emit_text(nest, line)

        # Real failures = all in failed_keys (dependency_failed + node-exhausted)
        fail_n = len(failed_keys)
        await _emit_task_summary(
            nest,
            success=success_n,
            failed=fail_n,
            needsUser=needs_user_n,
            skipped=skipped_n,
            lines=summary_lines,
        )

        # W15: persist progress to GenProgress table
        gen_progress_id = None
        if thread_id and session_id:
            try:
                result = await nest.save_gen_progress(
                    thread_id=thread_id,
                    session_id=session_id,
                    lines=json.dumps(progress_lines),
                    summary=json.dumps(summary_lines) if summary_lines else None,
                )
                gen_progress_id = result.get("id")
            except Exception as e:  # noqa: BLE001
                logging.getLogger(__name__).warning(f"Failed to save gen progress: {e}")

        if success_n or fail_n or needs_user_n or skipped_n:
            msg = format_gen_summary(
                lines=progress_lines,
                success_n=success_n,
                fail_n=fail_n,
                fallback_n=fallback_n,
            )
        else:
            msg = "无可自动生成的图片/视频节点。"

        partial = success_n > 0 and (fail_n > 0 or needs_user_n > 0)
        result: dict[str, Any] = {
            "phase": "orchestrate_gen",
            "gen_progress_id": gen_progress_id,
            "messages": [AIMessage(content=msg)],
            **clear_tier_b_gen_run_state(),
        }
        if partial:
            result["force_choice"] = "gen_partial"
        return result

    return collect_gen
