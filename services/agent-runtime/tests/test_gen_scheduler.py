"""Unit tests for gen_scheduler (Send-API central generation arbiter).

gen_scheduler is called with the FULL accumulated state (merged by reducers
after a superstep) and returns a Command. Tests call it directly and assert on
Command.goto (Send targets / collect_gen) and Command.update (cascade marks).
No graph compilation needed — this is pure state→Command logic.
"""

from __future__ import annotations

from typing import Any

import pytest
from langgraph.types import Send

from app.graph.nodes.gen_scheduler import make_gen_scheduler_node


def _scheduler(max_c: int = 3):
    return make_gen_scheduler_node(max_concurrency=max_c)


def _item(key: str, *, node_id: str = "n-" + "k", deps: list[str] | None = None, title: str = "t") -> dict[str, Any]:
    return {"key": key, "node_id": node_id, "title": title, "depends_on": deps or []}


def _state(
    ordered: list[str],
    by_key: dict[str, dict],
    *,
    deps_of: dict[str, list[str]] | None = None,
    completed: list[str] | None = None,
    failed: list[str] | None = None,
    needs_user: list[str] | None = None,
    fail_details: dict[str, dict] | None = None,
) -> dict[str, Any]:
    return {
        "gen_ordered_keys": ordered,
        "gen_deps_of": deps_of or {k: by_key[k].get("depends_on", []) for k in ordered},
        "gen_by_key": by_key,
        "gen_completed_keys": completed,
        "gen_failed_keys": failed,
        "gen_needs_user_keys": needs_user,
        "gen_fail_details": fail_details,
    }


def _dispatched_keys(cmd) -> list[str]:
    """Extract keys from Command.goto Send targets (ignores non-Send like 'collect_gen')."""
    return [s.arg["key"] for s in cmd.goto if isinstance(s, Send)]


def _goto_node(cmd) -> str | None:
    """If goto is a plain node name (not Send), return it."""
    for g in cmd.goto:
        if isinstance(g, str):
            return g
    return None


# 1. dispatch_ready ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_dispatches_all_ready_when_no_deps():
    sched = _scheduler()
    by_key = {"a": _item("a", deps=[]), "b": _item("b", deps=[])}
    cmd = await sched(_state(["a", "b"], by_key))
    assert sorted(_dispatched_keys(cmd)) == ["a", "b"]
    # update should be empty (no cascade marks needed)
    assert cmd.update == {}


# 2. concurrency -------------------------------------------------------------------
@pytest.mark.asyncio
async def test_respects_max_concurrency_cap():
    sched = _scheduler(max_c=2)
    by_key = {k: _item(k, deps=[]) for k in ["a", "b", "c", "d"]}
    cmd = await sched(_state(["a", "b", "c", "d"], by_key))
    dispatched = _dispatched_keys(cmd)
    assert len(dispatched) == 2
    # only the first 2 in topo order
    assert dispatched == ["a", "b"]


# 3. goto_collect ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_goes_to_collect_when_all_processed():
    sched = _scheduler()
    by_key = {"a": _item("a", deps=[]), "b": _item("b", deps=["a"])}
    cmd = await sched(_state(["a", "b"], by_key, completed=["a", "b"]))
    assert _goto_node(cmd) == "collect_gen"
    assert _dispatched_keys(cmd) == []


# 4. cascade_failed ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_cascade_marks_dependent_as_dependency_failed():
    sched = _scheduler()
    by_key = {
        "white_bg": _item("white_bg", deps=[]),
        "hero": _item("hero", deps=["white_bg"]),
    }
    cmd = await sched(_state(["white_bg", "hero"], by_key, failed=["white_bg"]))
    # hero should be marked dependency_failed, not dispatched
    assert _dispatched_keys(cmd) == []
    assert cmd.update["gen_failed_keys"] == ["hero"]
    assert cmd.update["gen_fail_details"]["hero"]["reason"] == "dependency_failed"


# 5. cascade_skipped ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_cascade_marks_dependent_as_dependency_skipped():
    sched = _scheduler()
    by_key = {
        "white_bg": _item("white_bg", deps=[]),
        "hero": _item("hero", deps=["white_bg"]),
    }
    cmd = await sched(
        _state(["white_bg", "hero"], by_key, needs_user=["white_bg"])
    )
    assert _dispatched_keys(cmd) == []
    assert cmd.update["gen_needs_user_keys"] == ["hero"]
    assert cmd.update["gen_fail_details"]["hero"]["reason"] == "dependency_skipped"


# 6. diamond_no_deadlock -----------------------------------------------------------
@pytest.mark.asyncio
async def test_diamond_dependency_dispatches_C_after_both_A_B_done():
    """C depends on A and B; A and B both complete → C is dispatched (not deadlocked)."""
    sched = _scheduler()
    by_key = {
        "a": _item("a", deps=[]),
        "b": _item("b", deps=[]),
        "c": _item("c", deps=["a", "b"]),
    }
    # A and B done in a prior superstep → scheduler should dispatch C
    cmd = await sched(_state(["a", "b", "c"], by_key, completed=["a", "b"]))
    assert _dispatched_keys(cmd) == ["c"]


# 7. transitive_cascade -------------------------------------------------------------
@pytest.mark.asyncio
async def test_transitive_cascade_through_chain():
    """A failed → B (deps A) dependency_failed → C (deps B) dependency_failed."""
    sched = _scheduler()
    by_key = {
        "a": _item("a", deps=[]),
        "b": _item("b", deps=["a"]),
        "c": _item("c", deps=["b"]),
    }
    cmd = await sched(_state(["a", "b", "c"], by_key, failed=["a"]))
    # Both B and C should be cascade-marked failed (topo order ensures B before C)
    assert sorted(cmd.update["gen_failed_keys"]) == ["b", "c"]
    assert cmd.update["gen_fail_details"]["b"]["reason"] == "dependency_failed"
    assert cmd.update["gen_fail_details"]["c"]["reason"] == "dependency_failed"
    assert _dispatched_keys(cmd) == []


# 8. no_redispatch -----------------------------------------------------------------
@pytest.mark.asyncio
async def test_does_not_redispatch_completed_keys():
    sched = _scheduler()
    by_key = {"a": _item("a", deps=[]), "b": _item("b", deps=[])}
    cmd = await sched(_state(["a", "b"], by_key, completed=["a"]))
    # Only b should be dispatched (a already completed)
    assert _dispatched_keys(cmd) == ["b"]
