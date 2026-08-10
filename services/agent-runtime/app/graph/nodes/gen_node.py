"""Single generation task node (Send API fan-out worker).

Each ``gen_node`` invocation executes ONE manifest item's image/video generation
with retry, then returns a pure state-dict update. Dispatching of the next wave
(upstream-done → downstream-ready) is the responsibility of ``gen_scheduler``,
NOT this node — that centralised scheduling avoids the diamond-dependency
deadlock that per-node fan-out would cause (C depends on A,B; A and B run in
parallel; neither sees the other's completion, so C is never dispatched).

A node returns one of:
  - ``{"gen_completed_keys": [key]}``                      # success
  - ``{"gen_failed_keys": [key], "gen_fail_details": {key: {...}}}``   # hard fail
  - ``{"gen_needs_user_keys": [key], "gen_fail_details": {key: {...}}}`` # needs user
"""

from __future__ import annotations

from typing import Any, Callable

from app.errors import AgentToolError, from_exception
from app.graph.chain_refs import build_chain_ref_order
from app.graph.gen_copy import format_gen_progress_line
from app.graph.task_events import hint_for_error, is_recoverable, max_auto_retries


async def _emit_task_update(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_update", None)
    if fn is not None:
        await fn(**payload)


async def _emit_line(nest: Any, text: str) -> None:
    """Push a user-visible progress line mid-node (mirrors orchestrate_gen)."""
    emit = getattr(nest, "emit_text", None)
    if emit is not None:
        await emit(text if text.endswith("\n") else text + "\n")


def _is_gen_success(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status") or "").lower()
    if status == "fallback_pending":
        return False
    url = result.get("url")
    has_url = isinstance(url, str) and bool(url.strip())
    return status in ("completed", "success") or has_url


def _result_record_id(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    rid = result.get("generationRecordId")
    return str(rid) if rid else None


def _result_url(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    url = result.get("url")
    if isinstance(url, str) and url.strip():
        return url.strip()
    return None


def _result_status(result: Any, exc: BaseException | None = None) -> str:
    if exc is not None:
        return str(exc)
    if isinstance(result, dict) and result.get("status") is not None:
        return str(result.get("status"))
    return "error"


def make_gen_node(*, nest: Any) -> Callable:
    """Create the single-task generation worker node."""

    async def gen_node(state: dict) -> dict:
        key = state.get("key")
        if not key:
            return {}

        by_key = state.get("gen_by_key") or {}
        item = by_key.get(key)
        if not item:
            return {}

        node_id = item.get("node_id")
        title = str(item.get("title") or key)
        kind = str(item.get("target_type") or "image")

        if not node_id:
            await _emit_task_update(nest, id=key, status="failed", errorCode="missing_node_id")
            return {
                "gen_failed_keys": [key],
                "gen_fail_details": {key: {"node_id": None, "title": title, "reason": "missing_node_id"}},
            }

        plan_node_id = state.get("plan_node_id")
        retries = max_auto_retries()
        last_status = "error"
        last_reason = "error"
        last_record_id: str | None = None

        await _emit_task_update(nest, id=key, status="running", attempt=0, maxAttempts=retries)

        for attempt in range(retries + 1):
            if attempt > 0:
                await _emit_task_update(
                    nest,
                    id=key,
                    status="retrying",
                    attempt=attempt,
                    maxAttempts=retries,
                    errorHint=hint_for_error(last_status),
                )

            record_id = None
            try:
                ref_order = build_chain_ref_order(
                    item=dict(item),
                    by_key=by_key,
                    plan_node_id=str(plan_node_id) if plan_node_id else None,
                )
                attach = getattr(nest, "attach_refs", None)
                if attach is not None and ref_order:
                    await attach(str(node_id), ref_order)

                if kind == "video":
                    run = getattr(nest, "run_video_generation", None)
                    if run is None:
                        await _emit_task_update(
                            nest, id=key, status="failed", errorCode="video_not_supported"
                        )
                        return {
                            "gen_failed_keys": [key],
                            "gen_fail_details": {key: {"node_id": node_id, "title": title, "reason": "video_not_supported"}},
                        }
                    result = await run(str(node_id))
                else:
                    start_fn = getattr(nest, "start_image_generation", None)
                    if start_fn is not None:
                        started = await start_fn(str(node_id))
                        record_id = _result_record_id(started)
                        if record_id:
                            last_record_id = record_id
                            await _emit_task_update(
                                nest,
                                id=key,
                                status="running",
                                recordId=record_id,
                                attempt=attempt,
                                maxAttempts=retries,
                            )
                        wait_fn = getattr(nest, "wait_image_generation", None)
                        if wait_fn is not None and record_id:
                            result = await wait_fn(str(node_id), record_id)
                            if not _result_record_id(result):
                                result = {**result, "generationRecordId": record_id}
                        else:
                            result = started
                    else:
                        result = await nest.run_image_generation(str(node_id))
                        record_id = _result_record_id(result)
                        if record_id:
                            last_record_id = record_id

                if _is_gen_success(result):
                    payload: dict[str, Any] = {"id": key, "status": "done"}
                    if last_record_id:
                        payload["recordId"] = last_record_id
                    await _emit_task_update(nest, **payload)
                    await _emit_line(nest, format_gen_progress_line(title=title, status="completed"))
                    update: dict[str, Any] = {"gen_completed_keys": [key]}
                    url = _result_url(result)
                    if url:
                        update["gen_by_key"] = {
                            key: {
                                **dict(item),
                                "url": url,
                                "status": "completed",
                                **({"generationRecordId": last_record_id} if last_record_id else {}),
                            }
                        }
                    return update

                last_status = _result_status(result)
                last_reason = last_status
            except AgentToolError as exc:
                last_status = exc.error["error_type"]
                last_reason = exc.error["message"]
                result = None
            except Exception as exc:  # noqa: BLE001
                err = from_exception(str(key), exc)
                last_status = err["error_type"]
                last_reason = err["message"]
                result = None

            if not is_recoverable(last_status):
                hint = hint_for_error(last_status)
                upd: dict[str, Any] = {
                    "id": key,
                    "status": "needs_user",
                    "errorCode": last_status,
                    "errorHint": hint,
                }
                if last_record_id:
                    upd["recordId"] = last_record_id
                await _emit_task_update(nest, **upd)
                # P1-5: fallback_pending 不向聊天流 emit 单行（走画布 ByokFallbackConfirmDialog）
                if "fallback_pending" not in last_status.lower():
                    await _emit_line(nest, format_gen_progress_line(title=title, status=last_status))
                return {
                    "gen_needs_user_keys": [key],
                    "gen_fail_details": {key: {"node_id": node_id, "title": title, "reason": last_reason}},
                }

            # recoverable → retry loop continues

        # Exhausted retries
        hint = hint_for_error(last_status)
        fail_upd: dict[str, Any] = {
            "id": key,
            "status": "failed",
            "errorCode": last_status,
            "errorHint": hint,
        }
        if last_record_id:
            fail_upd["recordId"] = last_record_id
        await _emit_task_update(nest, **fail_upd)
        await _emit_line(nest, format_gen_progress_line(title=title, status=last_status))
        return {
            "gen_failed_keys": [key],
            "gen_fail_details": {key: {"node_id": node_id, "title": title, "reason": last_reason}},
        }

    return gen_node
