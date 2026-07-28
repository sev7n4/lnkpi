"""Collect generation results and emit final summary."""

from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.gen_copy import format_gen_progress_line, format_gen_summary
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
    """Create collect_gen node that aggregates results and emits summary.

    Args:
        nest: Nest client for emitting events

    Returns:
        Callable that returns final state update
    """

    async def collect_gen(state: dict) -> dict:
        completed_keys = set(state.get("gen_completed_keys") or [])
        failed_keys = set(state.get("gen_failed_keys") or [])
        needs_user_keys = set(state.get("gen_needs_user_keys") or [])
        by_key = state.get("gen_by_key", {})
        ordered_keys = state.get("gen_ordered_keys", [])

        thread_id = state.get("thread_id", "")
        session_id = state.get("session_id", "")

        progress_lines: list[str] = []
        summary_lines: list[dict[str, str]] = []
        fallback_n = 0
        needs_user_n = 0
        skipped_n = 0
        success_n = 0

        # Process results
        for key in ordered_keys:
            item = by_key.get(key, {})
            node_id = str(item.get("node_id") or key)
            title = str(item.get("title") or key)

            if key in completed_keys:
                success_n += 1
                line = format_gen_progress_line(title=title, status="completed")
                progress_lines.append(line)
                await _emit_text(nest, line)
            elif key in needs_user_keys:
                reason = "needs_user"
                needs_user_n += 1
                reason_lower = str(reason).lower()
                if reason_lower == "fallback_pending":
                    fallback_n += 1
                summary_lines.append(
                    {
                        "id": key,
                        "status": "needs_user",
                        "title": title,
                        "hint": hint_for_error(reason),
                    }
                )
                line = format_gen_progress_line(title=title, status=str(reason))
                progress_lines.append(line)
                if reason_lower != "fallback_pending":
                    await _emit_text(nest, line)
            elif key in failed_keys:
                # Check if it was dependency_skipped or dependency_failed
                reason = "dependency_failed"  # Default, could be refined
                summary_lines.append(
                    {
                        "id": key,
                        "status": "failed",
                        "title": title,
                        "hint": hint_for_error(reason),
                    }
                )
                line = format_gen_progress_line(title=title, status=str(reason))
                progress_lines.append(line)
                await _emit_text(nest, line)

        # Calculate fail_only (exclude needs_user and dependency_skipped)
        fail_only = max(0, len(failed_keys) - needs_user_n - skipped_n)

        # Emit task summary
        await _emit_task_summary(
            nest,
            success=success_n,
            failed=fail_only,
            needsUser=needs_user_n,
            skipped=skipped_n,
            lines=summary_lines,
        )

        # W15: Save progress to GenProgress table
        gen_progress_id = None
        if thread_id and session_id:
            try:
                lines_json = json.dumps(progress_lines)
                summary_json = json.dumps(summary_lines) if summary_lines else None
                result = await nest.save_gen_progress(
                    thread_id=thread_id,
                    session_id=session_id,
                    lines=lines_json,
                    summary=summary_json,
                )
                gen_progress_id = result.get("id")
            except Exception as e:
                # Log but don't fail the node
                import logging
                logging.getLogger(__name__).warning(f"Failed to save gen progress: {e}")

        # Format final message
        fail_n = len(failed_keys)
        if success_n or fail_n:
            msg = format_gen_summary(
                lines=progress_lines,
                success_n=success_n,
                fail_n=fail_n,
                fallback_n=fallback_n,
            )
        else:
            msg = "无可自动生成的图片/视频节点。"

        return {
            "phase": "orchestrate_gen",
            "gen_progress_id": gen_progress_id,
            "messages": [AIMessage(content=msg)],
            # Clean up transient state
            "gen_ordered_keys": None,
            "gen_deps_of": None,
            "gen_by_key": None,
            "gen_completed_keys": None,
            "gen_failed_keys": None,
            "gen_needs_user_keys": None,
        }

    return collect_gen