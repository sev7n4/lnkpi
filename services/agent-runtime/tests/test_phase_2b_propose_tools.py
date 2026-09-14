"""Phase 2b §6.0.2: propose/upsert media tools gates (B1 / B2 / B3 / B8).

Failing until Task 2–3 wire registry + Nest/runtime handlers.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.tools.tool_plan import build_tool_plan
from app.tools.tool_registry import TOOL_EXPOSURES, ToolExposure


def _as_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    raise TypeError(f"unexpected tool result type: {type(raw)!r}")


def test_b1_propose_and_upsert_visible_run_gen_not():
    plan = build_tool_plan()
    assert "propose_generation" in plan.visible_names
    assert "upsert_media_node" in plan.visible_names
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names


def test_b2_connect_nodes_exposure_is_core():
    assert TOOL_EXPOSURES.get("connect_nodes") == ToolExposure.CORE
    plan = build_tool_plan()
    assert "connect_nodes" in plan.visible_names


class _FakeNestPropose:
    """Records propose / run_* calls; simulates Nest prompt gate for B3/B8."""

    def __init__(self, *, prompt_by_node: dict[str, str]) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.prompt_by_node = prompt_by_node
        self.pending_nodes: set[str] = set()

    async def propose_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("propose_generation", node_id))
        prompt = (self.prompt_by_node.get(node_id) or "").strip()
        if not prompt:
            return {
                "ok": False,
                "error": "missing_prompt",
                "nodeId": node_id,
            }
        self.pending_nodes.add(node_id)
        return {
            "ok": True,
            "nodeId": node_id,
            "status": "pending_confirm",
            "summary": {"prompt": prompt},
            "actions": [],
        }

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_image_generation", node_id))
        return {"ok": True}

    async def run_video_generation(self, node_id: str) -> dict[str, Any]:
        self.calls.append(("run_video_generation", node_id))
        return {"ok": True}


def _run_star_calls(nest: _FakeNestPropose) -> list[tuple[Any, ...]]:
    return [
        c
        for c in nest.calls
        if c[0] in ("run_image_generation", "run_video_generation")
    ]


@pytest.mark.asyncio
async def test_b3_propose_never_calls_run_star():
    """B3: propose_generation marks pending; never invokes run_*."""
    from app.tools.definitions import build_explore_tools
    from app.tools.nest_client import NestCanvasClient

    assert hasattr(NestCanvasClient, "propose_generation"), (
        "NestCanvasClient.propose_generation missing until Task 3"
    )

    nest = _FakeNestPropose(prompt_by_node={"n1": "blue sky product hero"})
    by_name = {t.name: t for t in build_explore_tools(nest)}  # type: ignore[arg-type]
    assert "propose_generation" in by_name

    raw = await by_name["propose_generation"].ainvoke({"node_id": "n1"})
    result = _as_dict(raw)
    assert result.get("status") == "pending_confirm"
    assert "n1" in nest.pending_nodes
    assert _run_star_calls(nest) == []


@pytest.mark.asyncio
async def test_b8_propose_missing_prompt_errors_no_pending_no_run():
    """B8: missing prompt → error; no pending; no run_*."""
    from app.tools.definitions import build_explore_tools
    from app.tools.nest_client import NestCanvasClient

    assert hasattr(NestCanvasClient, "propose_generation"), (
        "NestCanvasClient.propose_generation missing until Task 3"
    )

    nest = _FakeNestPropose(prompt_by_node={"n-empty": ""})
    by_name = {t.name: t for t in build_explore_tools(nest)}  # type: ignore[arg-type]
    assert "propose_generation" in by_name

    raw = await by_name["propose_generation"].ainvoke({"node_id": "n-empty"})
    result = _as_dict(raw)
    assert result.get("ok") is False or result.get("error")
    assert result.get("status") != "pending_confirm"
    assert "n-empty" not in nest.pending_nodes
    assert _run_star_calls(nest) == []
