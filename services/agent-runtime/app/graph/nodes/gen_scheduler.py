"""Generation scheduler: the single arbiter that fans out gen_node via Send.

Why a central scheduler (not per-node fan-out):
  - Diamond dependencies (C depends on A,B; A,B run in parallel) deadlock under
    per-node fan-out: A completes, sees B not done, doesn't dispatch C; B
    completes, doesn't know A finished, doesn't dispatch C either. A central
    scheduler reads the FULL accumulated state (merged by reducers after all
    parallel gen_node of a superstep finish) and is the only thing that decides
    what to dispatch next — so it always sees both A and B done.

Why no in-flight / dispatched tracking:
  - LangGraph Pregel batches all ``Send`` targets in one ``Command(goto=[...])``
    into a single superstep; they ALL complete (results merged via reducer)
    before the ``gen_node → gen_scheduler`` edge re-triggers the scheduler. So
    "in-flight" is always 0 when the scheduler runs — concurrency is simply
    ``ready[:max_concurrency]`` per superstep. ``completed/failed/needs_user``
    already prevent re-dispatch, so no separate dispatched-set is needed.

Termination: when nothing is ready to dispatch, every remaining unprocessed key
has been cascade-marked failed/needs_user by the forward topo pass, so all keys
are processed → ``goto collect_gen``.
"""

from __future__ import annotations

from typing import Any, Callable

from langgraph.types import Command, Send

from app.config import settings


def _detail(by_key: dict[str, dict], key: str, reason: str) -> dict[str, dict]:
    item = by_key.get(key, {})
    return {key: {"node_id": item.get("node_id"), "title": str(item.get("title") or key), "reason": reason}}


def make_gen_scheduler_node(*, max_concurrency: int | None = None) -> Callable:
    """Create the generation scheduler node (pure state computation, no nest)."""

    cap = max(1, int(max_concurrency or settings.image_gen_concurrency))

    async def gen_scheduler(state: dict) -> Command:
        ordered_keys = list(state.get("gen_ordered_keys") or [])
        deps_of = state.get("gen_deps_of") or {}
        by_key = state.get("gen_by_key") or {}
        max_c = cap

        completed: set[str] = set(state.get("gen_completed_keys") or [])
        failed: set[str] = set(state.get("gen_failed_keys") or [])
        needs_user: set[str] = set(state.get("gen_needs_user_keys") or [])

        # 1. Forward topo cascade: mark dependency_failed / dependency_skipped.
        # ordered_keys is topo-sorted, so a key's deps are classified before it.
        new_failed: list[str] = []
        new_needs_user: list[str] = []
        new_details: dict[str, dict] = {}
        for k in ordered_keys:
            if k in completed or k in failed or k in needs_user:
                continue
            deps = deps_of.get(k, [])
            dead = [d for d in deps if d in failed]
            pending = [d for d in deps if d in needs_user]
            if dead:
                failed.add(k)
                new_failed.append(k)
                new_details.update(_detail(by_key, k, "dependency_failed"))
            elif pending:
                needs_user.add(k)
                new_needs_user.append(k)
                new_details.update(_detail(by_key, k, "dependency_skipped"))

        # 2. Ready = unprocessed with all deps completed.
        processed = completed | failed | needs_user
        ready = [
            k
            for k in ordered_keys
            if k not in processed and all(d in completed for d in deps_of.get(k, []))
        ]
        to_dispatch = ready[:max_c]

        # 3. Build update (cascade results only — gen_node owns its own results).
        update: dict[str, Any] = {}
        if new_failed:
            update["gen_failed_keys"] = new_failed
        if new_needs_user:
            update["gen_needs_user_keys"] = new_needs_user
        if new_details:
            update["gen_fail_details"] = new_details

        # 4. Dispatch or finish.
        if to_dispatch:
            plan_node_id = state.get("plan_node_id")
            return Command(
                update=update,
                goto=[
                    # Send payload is the ONLY input gen_node sees (LangGraph Send
                    # does not merge channel state into the worker's input), so we
                    # must pass the shared context it needs alongside the key.
                    Send(
                        "gen_node",
                        {
                            "key": k,
                            "gen_by_key": by_key,
                            "plan_node_id": plan_node_id,
                        },
                    )
                    for k in to_dispatch
                ],
            )
        # Nothing ready → cascade has marked everything unprocessed as
        # failed/needs_user → all keys processed → collect.
        return Command(update=update, goto=["collect_gen"])

    return gen_scheduler
