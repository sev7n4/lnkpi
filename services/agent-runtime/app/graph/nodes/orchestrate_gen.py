"""Orchestrate topological image/video generation with retry and task events."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.chain_refs import build_chain_ref_order
from app.graph.gen_copy import format_gen_progress_line, format_gen_summary
from app.graph.task_events import hint_for_error, is_recoverable, max_auto_retries
from app.graph.topo import topo_sort_gen_keys

DEFAULT_MAX_CONCURRENCY = 3


def _is_gen_success(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status") or "").lower()
    if status == "fallback_pending":
        return False
    url = result.get("url")
    has_url = isinstance(url, str) and bool(url.strip())
    return status in ("completed", "success") or has_url


def _result_status(result: Any, exc: BaseException | None = None) -> str:
    if exc is not None:
        return str(exc)
    if isinstance(result, dict) and result.get("status") is not None:
        return str(result.get("status"))
    return "error"


async def _emit_task_update(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_update", None)
    if fn is not None:
        await fn(**payload)


async def _emit_task_summary(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_summary", None)
    if fn is not None:
        await fn(**payload)


def make_orchestrate_gen_node(
    *,
    nest: Any,
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
) -> Callable:
    async def orchestrate_gen(state: dict) -> dict:
        manifest = list(state.get("split_manifest") or [])
        by_key = {str(item["key"]): item for item in manifest if item.get("key")}
        retries = max_auto_retries()

        try:
            ordered_keys = topo_sort_gen_keys(manifest)
        except ValueError as exc:
            return {
                "phase": "orchestrate_gen",
                "gen_queue": [],
                "gen_completed": list(state.get("gen_completed") or []),
                "gen_failed": [
                    *(state.get("gen_failed") or []),
                    {"key": None, "reason": str(exc)},
                ],
                "last_error": str(exc),
                "messages": [AIMessage(content=f"出图编排失败：{exc}")],
            }

        gen_queue = [
            str(by_key[k]["node_id"])
            for k in ordered_keys
            if by_key.get(k) and by_key[k].get("node_id")
        ]

        key_set = set(ordered_keys)
        deps_of = {
            k: [str(d) for d in (by_key[k].get("depends_on") or []) if str(d) in key_set]
            for k in ordered_keys
        }

        completed_keys: set[str] = set()
        failed_keys: set[str] = set()
        needs_user_keys: set[str] = set()
        gen_completed: list[str] = []
        gen_failed: list[dict] = []
        progress_lines: list[str] = []
        fallback_n = 0
        needs_user_n = 0
        summary_lines: list[dict[str, str]] = []
        sem = asyncio.Semaphore(max(1, max_concurrency))
        remaining = set(ordered_keys)
        in_flight: dict[str, asyncio.Task] = {}

        async def emit_line(text: str) -> None:
            emit = getattr(nest, "emit_text", None)
            if emit is not None:
                await emit(text if text.endswith("\n") else text + "\n")

        async def run_one(key: str) -> tuple[str, str, str | None]:
            item = by_key[key]
            node_id = item.get("node_id")
            title = str(item.get("title") or key)
            kind = str(item.get("target_type") or "image")
            if not node_id:
                return key, "fail", "missing_node_id"

            async with sem:
                await _emit_task_update(
                    nest, id=key, status="running", attempt=0, maxAttempts=retries
                )
                last_status = "error"
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
                    try:
                        plan_node_id = state.get("plan_node_id")
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
                                return key, "fail", "video_not_supported"
                            result = await run(str(node_id))
                        else:
                            result = await nest.run_image_generation(str(node_id))
                        if _is_gen_success(result):
                            await _emit_task_update(nest, id=key, status="done")
                            return key, "ok", None
                        last_status = _result_status(result)
                    except Exception as exc:  # noqa: BLE001
                        last_status = str(exc)
                        result = None

                    if not is_recoverable(last_status):
                        hint = hint_for_error(last_status)
                        await _emit_task_update(
                            nest,
                            id=key,
                            status="needs_user",
                            errorCode=last_status,
                            errorHint=hint,
                        )
                        return key, "needs_user", last_status

                    if attempt >= retries:
                        break

                hint = hint_for_error(last_status)
                await _emit_task_update(
                    nest,
                    id=key,
                    status="failed",
                    errorCode=last_status,
                    errorHint=hint,
                )
                return key, "fail", last_status

        while remaining or in_flight:
            for key in sorted(remaining):
                deps = deps_of[key]
                # 修复 P1-6：依赖图故障传播策略
                # - 上游 "failed"（fatal error）→ 下游也 failed（不可恢复）
                # - 上游 "needs_user" / fallback_pending（可恢复）→ 下游 SKIPPED，等用户确认后可重试
                upstream_dead = [d for d in deps if d in failed_keys]
                upstream_pending = [d for d in deps if d in needs_user_keys]
                if upstream_dead or upstream_pending:
                    remaining.discard(key)
                    title = str(by_key[key].get("title") or key)
                    if upstream_dead:
                        # 真失败：标 failed
                        failed_keys.add(key)
                        reason = "dependency_failed"
                        hint_code = "dep_failed"
                    else:
                        # 上游待确认：标 skipped（不计入 failed），后续可重试
                        needs_user_keys.add(key)
                        reason = "dependency_skipped"
                        hint_code = "dep_skipped"
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": by_key[key].get("node_id"),
                            "title": title,
                            "reason": reason,
                        }
                    )
                    summary_lines.append(
                        {
                            "id": key,
                            "status": "skipped" if reason == "dependency_skipped" else "failed",
                            "title": title,
                            "hint": hint_for_error(hint_code),
                        }
                    )
                    await _emit_task_update(
                        nest,
                        id=key,
                        status="skipped" if reason == "dependency_skipped" else "failed",
                        errorCode=hint_code,
                        errorHint=hint_for_error(hint_code),
                    )
                    line = format_gen_progress_line(title=title, status=hint_code)
                    progress_lines.append(line)
                    await emit_line(line)
                    continue
                if not all(d in completed_keys for d in deps):
                    continue
                remaining.discard(key)
                in_flight[key] = asyncio.create_task(run_one(key))

            if not in_flight:
                for key in sorted(remaining):
                    failed_keys.add(key)
                    title = str(by_key[key].get("title") or key)
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": by_key[key].get("node_id"),
                            "title": title,
                            "reason": "dependency_failed",
                        }
                    )
                    line = format_gen_progress_line(title=title, status="dependency_failed")
                    progress_lines.append(line)
                    await emit_line(line)
                remaining.clear()
                break

            done, _ = await asyncio.wait(
                in_flight.values(), return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                key, status, err = task.result()
                del in_flight[key]
                item = by_key[key]
                node_id = str(item.get("node_id") or key)
                title = str(item.get("title") or key)
                if status == "ok":
                    completed_keys.add(key)
                    gen_completed.append(node_id)
                    line = format_gen_progress_line(title=title, status="completed")
                    progress_lines.append(line)
                    await emit_line(line)
                elif status == "needs_user":
                    needs_user_keys.add(key)
                    needs_user_n += 1
                    reason = err or "needs_user"
                    reason_lower = str(reason).lower()
                    if reason_lower == "fallback_pending":
                        fallback_n += 1
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": node_id,
                            "title": title,
                            "reason": reason,
                        }
                    )
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
                    # 修复 P1-5：fallback_pending 不再向聊天流 emit 单行提示
                    # 这条信息会通过画布 ByokFallbackConfirmDialog 提示用户，
                    # 聊天中只保留最终汇总，避免与 dialog 通道重复
                    if reason_lower != "fallback_pending":
                        await emit_line(line)
                else:
                    failed_keys.add(key)
                    reason = err or "failed"
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": node_id,
                            "title": title,
                            "reason": reason,
                        }
                    )
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
                    await emit_line(line)

        fail_only = max(0, len(gen_failed) - needs_user_n)
        await _emit_task_summary(
            nest,
            success=len(gen_completed),
            failed=fail_only,
            needsUser=needs_user_n,
            skipped=0,
            lines=summary_lines,
        )

        if gen_queue:
            msg = format_gen_summary(
                lines=progress_lines,
                success_n=len(gen_completed),
                fail_n=len(gen_failed),
                fallback_n=fallback_n,
            )
        else:
            msg = "无可自动生成的图片/视频节点。"
        return {
            "phase": "orchestrate_gen",
            "gen_queue": gen_queue,
            "gen_completed": gen_completed,
            "gen_failed": gen_failed,
            "messages": [AIMessage(content=msg)],
        }

    return orchestrate_gen
