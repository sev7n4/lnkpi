"""Integration tests for the W3 Send-API generation subgraph.

These exercise the full ``start_gen → gen_scheduler ⇄ gen_node → collect_gen``
subgraph via ``ainvoke`` (with a real MemorySaver checkpointer), covering the
cross-node scenarios that unit tests can't: diamond dependencies across waves,
concurrency caps across supersteps, and checkpoint recovery (completed nodes are
not re-run after a simulated crash/resume).
"""

from __future__ import annotations

from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes.collect_gen import make_collect_gen_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.state import AgentRuntimeState


class _Nest:
    """Records every run_image_generation call by node_id."""

    def __init__(self, *, fail_keys: set[str] | None = None) -> None:
        self.calls: list[str] = []
        self.fail_keys = fail_keys or set()
        self.saved_lines: list[str] = []

    async def emit_task_update(self, **payload: Any) -> None:
        pass

    async def emit_task_summary(self, **payload: Any) -> None:
        pass

    async def emit_text(self, text: str) -> None:
        pass

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(node_id)
        if node_id in self.fail_keys:
            raise RuntimeError(f"gen failed: {node_id}")
        return {"nodeId": node_id, "status": "completed"}

    async def save_gen_progress(self, **kwargs: Any) -> dict[str, Any]:
        import json

        raw = kwargs.get("lines") or "[]"
        self.saved_lines = json.loads(raw) if isinstance(raw, str) else list(raw)
        return {"id": "gp-1"}

    async def get_gen_progress(self, thread_id: str) -> dict[str, Any]:
        import json

        return {
            "id": "gp-1",
            "lines": json.dumps(self.saved_lines),
            "summary": None,
        }


def _build_subgraph(nest: _Nest, *, max_concurrency: int = 3):
    g = StateGraph(AgentRuntimeState)
    g.add_node("start_gen", make_start_gen_node())
    g.add_node("gen_scheduler", make_gen_scheduler_node(max_concurrency=max_concurrency))
    g.add_node("gen_node", make_gen_node(nest=nest))
    g.add_node("collect_gen", make_collect_gen_node(nest=nest))
    g.add_node("done", make_done_node(nest=nest))
    g.add_edge(START, "start_gen")
    g.add_edge("start_gen", "gen_scheduler")
    g.add_edge("gen_node", "gen_scheduler")
    g.add_edge("collect_gen", "done")
    g.add_edge("done", END)
    return g.compile(checkpointer=MemorySaver())


def _img(key: str, deps: list[str], node_id: str) -> dict[str, Any]:
    return {
        "key": key,
        "target_type": "image",
        "auto_generate": True,
        "depends_on": deps,
        "node_id": node_id,
        "title": key,
    }


@pytest.mark.asyncio
async def test_diamond_dependency_completes_without_deadlock():
    """C depends on A and B (both independent); A and B run in parallel, then C.

    Per-node fan-out deadlocks here (A sees B not done, skips C; B sees A not
    done, skips C). The central scheduler sees both done after the first wave
    and dispatches C. Verifies all 3 complete and each is called exactly once.
    """
    nest = _Nest()
    graph = _build_subgraph(nest)
    manifest = [
        _img("a", [], "n-a"),
        _img("b", [], "n-b"),
        _img("c", ["a", "b"], "n-c"),
    ]
    result = await graph.ainvoke(
        {"split_manifest": manifest, "thread_id": "diamond", "session_id": "s-diamond"},
        {"configurable": {"thread_id": "diamond"}, "recursion_limit": 100},
    )
    assert result.get("gen_progress_id") == "gp-1"
    assert len(nest.saved_lines) == 3
    assert all("出图成功" in ln for ln in nest.saved_lines)
    # Each node called exactly once (no re-runs)
    assert sorted(nest.calls) == ["n-a", "n-b", "n-c"]
    assert len(nest.calls) == 3


@pytest.mark.asyncio
async def test_concurrency_cap_runs_in_waves():
    """4 independent nodes with max_concurrency=2 → 2 waves of 2.

    All 4 still complete (the cap only limits parallelism, not throughput).
    """
    nest = _Nest()
    graph = _build_subgraph(nest, max_concurrency=2)
    manifest = [_img(k, [], f"n-{k}") for k in ["a", "b", "c", "d"]]
    result = await graph.ainvoke(
        {"split_manifest": manifest, "thread_id": "conc", "session_id": "s-conc"},
        {"configurable": {"thread_id": "conc"}, "recursion_limit": 100},
    )
    assert result.get("gen_progress_id") == "gp-1"
    assert len(nest.saved_lines) == 4
    assert len(nest.calls) == 4


@pytest.mark.asyncio
async def test_checkpoint_recovery_does_not_rerun_completed():
    """Simulate a crash after white_bg completes: resume should NOT re-run it.

    Uses interrupt_before on gen_node to halt after the first dispatch wave
    (white_bg), then resumes — gen_scheduler should see white_bg already
    completed (from checkpoint) and only dispatch hero_main.
    """
    nest = _Nest()
    g = StateGraph(AgentRuntimeState)
    g.add_node("start_gen", make_start_gen_node())
    g.add_node("gen_scheduler", make_gen_scheduler_node())
    g.add_node("gen_node", make_gen_node(nest=nest))
    g.add_node("collect_gen", make_collect_gen_node(nest=nest))
    g.add_node("done", make_done_node(nest=nest))
    g.add_edge(START, "start_gen")
    g.add_edge("start_gen", "gen_scheduler")
    g.add_edge("gen_node", "gen_scheduler")
    g.add_edge("collect_gen", "done")
    g.add_edge("done", END)
    # interrupt BEFORE gen_node → halts right before dispatching white_bg
    graph = g.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["gen_node"],
    )
    config = {"configurable": {"thread_id": "ckpt"}, "recursion_limit": 100}
    manifest = [
        _img("white_bg", [], "n-w"),
        _img("hero_main", ["white_bg"], "n-h"),
    ]

    # First ainvoke: start_gen → gen_scheduler → halts before gen_node(white_bg)
    await graph.ainvoke(
        {"split_manifest": manifest, "thread_id": "ckpt", "session_id": "s-ckpt"},
        config,
    )
    assert nest.calls == []  # gen_node hasn't run yet (interrupted before it)

    # Resume: gen_node(white_bg) runs → gen_scheduler → halts before gen_node(hero_main)
    await graph.ainvoke(None, config)
    assert nest.calls == ["n-w"]  # only white_bg ran

    # Resume again: gen_node(hero_main) runs → gen_scheduler → collect_gen → END
    result = await graph.ainvoke(None, config)
    assert result.get("gen_progress_id") == "gp-1"
    assert len(nest.saved_lines) == 2
    # white_bg was NOT re-run during the resume (checkpoint recovery)
    assert nest.calls == ["n-w", "n-h"]
