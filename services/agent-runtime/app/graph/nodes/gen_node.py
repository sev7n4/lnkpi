"""Single generation task node with retry and dependency tracking."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage
from langgraph.types import Send

from app.graph.chain_refs import build_chain_ref_order
from app.graph.gen_copy import format_gen_progress_line
from app.graph.task_events import hint_for_error, is_recoverable, max_auto_retries
from app.graph.state import AgentRuntimeState


async def _emit_task_update(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_update", None)
    if fn is not None:
        await fn(**payload)


async def _emit_task_summary(nest: Any, **payload: Any) -> None:
    fn = getattr(nest, "emit_task_summary", None)
    if fn is not None:
        await fn(**payload)


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


def make_gen_node(
    *,
    nest: Any,
) -> Callable:
    """Create gen_node that executes a single generation task.

    Args:
        nest: Nest client for canvas operations

    Returns:
        Callable that returns dict or list[Send]
    """

    async def gen_node(state: dict) -> dict | list[Send]:
        key = state.get("key")
        if not key:
            return {}

        # Get generation context from state
        by_key = state.get("gen_by_key", {})
        deps_of = state.get("gen_deps_of", {})
        ordered_keys = state.get("gen_ordered_keys", [])
        completed_keys = set(state.get("gen_completed_keys") or [])
        failed_keys = set(state.get("gen_failed_keys") or [])
        needs_user_keys = set(state.get("gen_needs_user_keys") or [])

        item = by_key.get(key)
        if not item:
            return {}

        node_id = item.get("node_id")
        title = str(item.get("title") or key)
        kind = str(item.get("target_type") or "image")

        if not node_id:
            # Missing node_id, mark as failed
            return {
                "gen_failed_keys": list(failed_keys | {key}),
            }

        # Check if dependencies are met
        deps = deps_of.get(key, [])
        upstream_failed = [d for d in deps if d in failed_keys]
        upstream_pending = [d for d in deps if d in needs_user_keys]

        if upstream_failed or upstream_pending:
            # Dependency failed or pending, skip this node
            reason = "dependency_failed" if upstream_failed else "dependency_skipped"
            return {
                "gen_failed_keys": list(failed_keys | {key}),
                "gen_needs_user_keys": list(needs_user_keys | {key}) if upstream_pending else list(needs_user_keys),
            }

        if not all(d in completed_keys for d in deps):
            # Dependencies not ready yet, this shouldn't happen if start_gen works correctly
            # But handle it gracefully
            return {}

        # Execute generation with retry
        retries = max_auto_retries()
        last_status = "error"

        await _emit_task_update(
            nest, id=key, status="running", attempt=0, maxAttempts=retries
        )

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
                # Attach refs if needed
                plan_node_id = state.get("plan_node_id")
                ref_order = build_chain_ref_order(
                    item=dict(item),
                    by_key=by_key,
                    plan_node_id=str(plan_node_id) if plan_node_id else None,
                )
                attach = getattr(nest, "attach_refs", None)
                if attach is not None and ref_order:
                    await attach(str(node_id), ref_order)

                # Run generation
                if kind == "video":
                    run = getattr(nest, "run_video_generation", None)
                    if run is None:
                        await _emit_task_update(
                            nest, id=key, status="failed", errorCode="video_not_supported"
                        )
                        return {
                            "gen_failed_keys": list(failed_keys | {key}),
                        }
                    result = await run(str(node_id))
                else:
                    result = await nest.run_image_generation(str(node_id))

                if _is_gen_success(result):
                    await _emit_task_update(nest, id=key, status="done")

                    # Update completed keys
                    new_completed = completed_keys | {key}

                    # Find downstream nodes that are now ready
                    ready_downstream = []
                    for k in ordered_keys:
                        if k in new_completed or k in failed_keys or k in needs_user_keys:
                            continue
                        k_deps = deps_of.get(k, [])
                        if all(d in new_completed for d in k_deps):
                            ready_downstream.append(k)

                    if ready_downstream:
                        # Fan out to downstream nodes
                        sends: list[Send] = []
                        for k in ready_downstream:
                            sends.append(
                                Send(
                                    "gen_node",
                                    {
                                        "key": k,
                                        "gen_ordered_keys": ordered_keys,
                                        "gen_deps_of": deps_of,
                                        "gen_by_key": by_key,
                                        "gen_completed_keys": list(new_completed),
                                        "gen_failed_keys": list(failed_keys),
                                        "gen_needs_user_keys": list(needs_user_keys),
                                    },
                                )
                            )
                        return sends
                    else:
                        # No more downstream nodes, check if all done
                        all_done = len(new_completed) + len(failed_keys) + len(needs_user_keys)
                        if all_done >= len(ordered_keys):
                            # All nodes processed, collect results
                            return [
                                Send(
                                    "collect_gen",
                                    {
                                        "gen_completed_keys": list(new_completed),
                                        "gen_failed_keys": list(failed_keys),
                                        "gen_needs_user_keys": list(needs_user_keys),
                                        "gen_by_key": by_key,
                                        "gen_ordered_keys": ordered_keys,
                                    },
                                )
                            ]
                        return {
                            "gen_completed_keys": list(new_completed),
                        }

                last_status = _result_status(result)

            except Exception as exc:  # noqa: BLE001
                last_status = str(exc)
                result = None

            if not is_recoverable(last_status):
                # Non-recoverable error, mark as needs_user
                hint = hint_for_error(last_status)
                await _emit_task_update(
                    nest,
                    id=key,
                    status="needs_user",
                    errorCode=last_status,
                    errorHint=hint,
                )
                new_needs_user = needs_user_keys | {key}
                return {
                    "gen_needs_user_keys": list(new_needs_user),
                }

            # Continue retry loop

        # Exhausted retries
        hint = hint_for_error(last_status)
        await _emit_task_update(
            nest,
            id=key,
            status="failed",
            errorCode=last_status,
            errorHint=hint,
        )
        return {
            "gen_failed_keys": list(failed_keys | {key}),
        }

    return gen_node