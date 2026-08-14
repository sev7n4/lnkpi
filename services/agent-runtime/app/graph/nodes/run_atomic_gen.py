"""P4: run Studio generation for one atomic-created node."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.sidebar_copy import (
    format_atomic_gen_failed,
    format_atomic_gen_partial,
    format_atomic_gen_success,
)


def _is_success(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status") or "").lower()
    if status in ("completed", "success"):
        return True
    url = result.get("url")
    return isinstance(url, str) and bool(url.strip())


def _result_record_id(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    rid = result.get("generationRecordId")
    return str(rid) if rid else None


async def _emit_task_update(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_update", None)
    if fn is not None:
        await fn(**payload)


def make_run_atomic_gen_node(*, nest: Any) -> Callable:
    async def run_atomic_gen(state: dict) -> dict:
        items = [dict(i) for i in (state.get("atomic_items") or []) if isinstance(i, dict)]
        if not items:
            node_id = str(state.get("atomic_node_id") or "").strip()
            spec = state.get("atomic_spec") or {}
            if node_id:
                items = [{**spec, "node_id": node_id}]

        if not items:
            return {
                "phase": "error",
                "last_error": "missing atomic_node_id",
                "messages": [AIMessage(content="缺少画布节点，无法生产。")],
            }

        runners = {
            "image": getattr(nest, "run_image_generation", None),
            "video": getattr(nest, "run_video_generation", None),
            "text": getattr(nest, "run_text_generation", None),
            "prompt": getattr(nest, "run_prompt_generation", None),
            "audio": getattr(nest, "run_audio_generation", None),
        }

        completed: list[str] = []
        failed: list[str] = []
        last_record_id: str | None = None
        last_completion_summary: str | None = None
        last_error: str | None = None

        for item in items:
            node_id = str(item.get("node_id") or state.get("atomic_node_id") or "").strip()
            target_type = str(item.get("target_type") or "image")
            title = str(item.get("title") or target_type)
            task_id = f"atomic-{node_id}" if node_id else None
            if not node_id:
                failed.append(title)
                last_error = "missing atomic_node_id"
                continue

            run = runners.get(target_type)
            if run is None:
                failed.append(title)
                last_error = f"unsupported target_type: {target_type}"
                continue

            if task_id:
                await _emit_task_update(
                    nest,
                    id=task_id,
                    status="running",
                    nodeId=node_id,
                    recordId=None,
                )

            try:
                if target_type == "video":
                    start_fn = getattr(nest, "start_video_generation", None)
                    wait_fn = getattr(nest, "wait_video_generation", None)
                    if start_fn is not None and wait_fn is not None:
                        started = await start_fn(node_id)
                        record_id = _result_record_id(started)
                        if record_id:
                            last_record_id = record_id
                            if task_id:
                                await _emit_task_update(
                                    nest,
                                    id=task_id,
                                    status="running",
                                    nodeId=node_id,
                                    recordId=record_id,
                                )
                            result = await wait_fn(node_id, record_id)
                            if not _result_record_id(result):
                                result = {**result, "generationRecordId": record_id}
                        else:
                            result = started
                    else:
                        result = await run(node_id)
                else:
                    result = await run(node_id)
            except Exception as exc:  # noqa: BLE001
                failed.append(title)
                last_error = str(exc)
                if task_id:
                    await _emit_task_update(
                        nest,
                        id=task_id,
                        status="failed",
                        nodeId=node_id,
                        errorCode="exception",
                    )
                continue

            record_id = _result_record_id(result)
            if record_id:
                last_record_id = record_id

            if isinstance(result, dict) and result.get("completionSummary"):
                last_completion_summary = str(result["completionSummary"])

            if _is_success(result):
                completed.append(title)
                if task_id:
                    await _emit_task_update(
                        nest,
                        id=task_id,
                        status="done",
                        nodeId=node_id,
                        recordId=record_id,
                    )
            else:
                status = str(result.get("status") or "error") if isinstance(result, dict) else "error"
                failed.append(title)
                last_error = status
                if task_id:
                    await _emit_task_update(
                        nest,
                        id=task_id,
                        status="failed",
                        nodeId=node_id,
                        errorCode=status,
                    )

        if completed and not failed:
            if len(completed) == 1:
                msg = format_atomic_gen_success(completed[0])
            else:
                msg = format_atomic_gen_success(completed[0], count=len(completed))
            if last_completion_summary:
                msg += last_completion_summary
            return {
                "phase": "done",
                "atomic_record_id": last_record_id,
                "messages": [AIMessage(content=msg)],
            }

        if completed and failed:
            msg = format_atomic_gen_partial(completed, failed)
            return {
                "phase": "error",
                "atomic_record_id": last_record_id,
                "last_error": last_error,
                "messages": [AIMessage(content=msg)],
            }

        title = str(items[0].get("title") or items[0].get("target_type") or "节点")
        status = last_error or "error"
        return {
            "phase": "error",
            "atomic_record_id": last_record_id,
            "last_error": status,
            "messages": [AIMessage(content=format_atomic_gen_failed(title, status))],
        }

    return run_atomic_gen
