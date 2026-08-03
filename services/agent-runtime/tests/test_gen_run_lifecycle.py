"""P0-03: Tier B gen-run state lifecycle tests."""

from __future__ import annotations

from typing import Any

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.graph.gen_run_state import (
    TIER_B_GEN_RUN_FIELDS,
    clear_tier_b_gen_run_state,
    tier_b_fields_active,
)
from app.graph.nodes.collect_gen import make_collect_gen_node
from app.graph.nodes.done import make_done_node
from app.graph.nodes.gen_node import make_gen_node
from app.graph.nodes.gen_scheduler import make_gen_scheduler_node
from app.graph.nodes.start_gen import make_start_gen_node
from app.graph.state import AgentRuntimeState


def test_clear_tier_b_gen_run_state_covers_all_fields():
    cleared = clear_tier_b_gen_run_state()
    assert set(cleared.keys()) == set(TIER_B_GEN_RUN_FIELDS)
    assert all(v is None for v in cleared.values())


def test_tier_b_fields_active():
    state = {
        "gen_deps_of": {"a": []},
        "gen_completed_keys": ["a"],
    }
    assert set(tier_b_fields_active(state)) == {"gen_deps_of", "gen_completed_keys"}


class _Nest:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.saved_lines: list[str] = []

    async def emit_task_summary(self, **payload: Any) -> None:
        pass

    async def emit_text(self, text: str) -> None:
        pass

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(node_id)
        return {"nodeId": node_id, "status": "completed"}

    async def save_gen_progress(self, **kwargs: Any) -> dict[str, Any]:
        import json

        raw = kwargs.get("lines") or "[]"
        self.saved_lines = json.loads(raw) if isinstance(raw, str) else list(raw)
        return {"id": "gp-1"}

    async def get_gen_progress(self, thread_id: str) -> dict[str, Any]:
        import json

        return {"id": "gp-1", "lines": json.dumps(self.saved_lines), "summary": None}


def _img(key: str, node_id: str) -> dict[str, Any]:
    return {
        "key": key,
        "target_type": "image",
        "auto_generate": True,
        "depends_on": [],
        "node_id": node_id,
        "title": key,
    }


def _build_graph(nest: _Nest):
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
    return g.compile(checkpointer=MemorySaver())


@pytest.mark.asyncio
async def test_collect_gen_clears_tier_b_preserves_gen_ordered_keys():
    nest = _Nest()
    graph = _build_graph(nest)
    manifest = [_img("a", "n-a")]
    result = await graph.ainvoke(
        {
            "split_manifest": manifest,
            "gen_ordered_keys": ["a"],
            "thread_id": "t1",
            "session_id": "s1",
        },
        {"configurable": {"thread_id": "t1"}, "recursion_limit": 50},
    )
    assert tier_b_fields_active(result) == []
    assert result.get("gen_ordered_keys") == ["a"]


@pytest.mark.asyncio
async def test_second_gen_run_on_same_thread_does_not_skip_nodes():
    """Stale gen_completed_keys must not survive collect_gen → next start_gen."""
    nest = _Nest()
    graph = _build_graph(nest)
    config = {"configurable": {"thread_id": "re-run"}, "recursion_limit": 50}
    base = {
        "split_manifest": [_img("a", "n-a")],
        "gen_ordered_keys": ["a"],
        "thread_id": "re-run",
        "session_id": "s1",
    }

    await graph.ainvoke(base, config)
    assert nest.calls == ["n-a"]

    nest.calls.clear()
    await graph.ainvoke(base, config)
    assert nest.calls == ["n-a"]
