"""Decompose parse failure routing and topo-gate revise recovery."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.await_shot_topo_confirm import make_await_shot_topo_confirm_node
from app.graph.nodes.decompose_from_ssot import make_decompose_from_ssot_node
from app.graph.product_visual_v2.routing import route_after_decompose_from_ssot
from app.graph.product_visual_v2.journey_trace import build_journey_trace_snapshot


class BadLLM:
    async def ainvoke(self, messages):  # noqa: ANN001, ARG002
        return type("R", (), {"content": "not valid json at all"})()


class FakeNest:
    async def upsert_prompt_node(self, *, prompt: str, content: str):  # noqa: ARG002
        return {"nodeId": "prompt-1"}


GOOD_SHOT = {
    "shot_id": "packaging_hero__1",
    "type_id": "packaging_hero",
    "label": "主图",
    "macro_scheme_id": "A",
    "variant_count": 1,
    "variant_eligible": False,
    "shot_prose": "主视觉构图",
    "refs_policy": {"requires": ["white_bg"], "optional": []},
}


class GoodLLM:
    async def ainvoke(self, messages):  # noqa: ANN001, ARG002
        import json

        return type("R", (), {"content": json.dumps({"shots": [GOOD_SHOT]}, ensure_ascii=False)})()


@pytest.mark.asyncio
async def test_decompose_parse_failure_routes_to_done():
    from pathlib import Path

    from app.config import settings

    node = make_decompose_from_ssot_node(
        llm=BadLLM(),
        skills_dir=Path(settings.skills_dir),
        nest=FakeNest(),
    )
    out = await node(
        {
            "plan_node_id": "node-ssot-1",
            "macro_scheme_draft": "方案正文" * 20,
            "selected_macro_scheme_ids": ["A"],
            "messages": [HumanMessage(content="大闸蟹 listing")],
        }
    )
    assert out["phase"] == "error"
    assert out["last_error"] == "decompose_shots_parse_failed"
    assert route_after_decompose_from_ssot(out) == "done"


def test_journey_trace_marks_shot_plan_failed_on_decompose_error():
    snap = build_journey_trace_snapshot(
        {"last_error": "decompose_shots_parse_failed"},
        phase="done",
    )
    shot_plan = next(s for s in snap["steps"] if s["id"] == "shot_plan")
    assert shot_plan["status"] == "failed"
    assert next(s for s in snap["steps"] if s["id"] == "done")["status"] == "pending"


@pytest.mark.asyncio
async def test_decompose_revise_after_successful_first_pass():
    from pathlib import Path

    from app.config import settings

    node = make_decompose_from_ssot_node(
        llm=GoodLLM(),
        skills_dir=Path(settings.skills_dir),
        nest=FakeNest(),
    )
    base_state = {
        "plan_node_id": "node-ssot-1",
        "macro_scheme_draft": "方案正文" * 20,
        "selected_macro_scheme_ids": ["A"],
        "messages": [HumanMessage(content="大闸蟹 listing")],
    }
    first = await node(base_state)
    assert first.get("shot_manifest")
    assert first["phase"] in ("await_shot_topo_confirm", "await_shot_confirm")

    gate = make_await_shot_topo_confirm_node()
    revise = await gate(
        {
            **base_state,
            "shot_manifest": first["shot_manifest"],
            "messages": [
                HumanMessage(content="大闸蟹 listing"),
                HumanMessage(content="调整构图，去掉营销海报"),
            ],
        }
    )
    assert revise["phase"] == "decompose_from_ssot"

    second = await node({**base_state, "messages": revise["messages"]})
    assert second.get("shot_manifest")
    assert second["phase"] in ("await_shot_topo_confirm", "await_shot_confirm")


@pytest.mark.asyncio
async def test_topo_gate_blocks_confirm_when_manifest_empty():
    gate = make_await_shot_topo_confirm_node()
    out = await gate(
        {
            "messages": [HumanMessage(content="确认构图并开始出图")],
            "shot_manifest": [],
        }
    )
    assert out["phase"] == "error"
    assert out["last_error"] == "shot_manifest_missing"
