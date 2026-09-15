"""Phase 2d.3 §6.0.8: literal cleanup + soft rename + shim (H1–H7)."""

from __future__ import annotations

import types
from pathlib import Path
from typing import Literal, Union, get_args, get_origin, get_type_hints

import pytest
import yaml
from langchain_core.messages import HumanMessage

from app.graph.decide_lane import (
    ALLOWED_LANES,
    DecideLaneResult,
    apply_decide_lane_postprocess,
    parse_decide_lane_json,
)
from app.graph.nodes.intake import make_intake_node
from app.graph.route_decide import RouteFlowMode
from app.graph.state import AgentRuntimeState

RETIRED = frozenset({"atomic_create", "atomic_regenerate", "single_node"})
SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


def _literal_strings(tp: object) -> set[str]:
    """Extract string members from Literal / Optional[Literal[...]]."""
    if tp is None or tp is type(None):
        return set()
    origin = get_origin(tp)
    if origin is Literal:
        return {a for a in get_args(tp) if isinstance(a, str)}
    if origin is Union or origin is types.UnionType:
        out: set[str] = set()
        for arg in get_args(tp):
            out |= _literal_strings(arg)
        return out
    return set()


def test_h1_allowed_and_types_lack_retired():
    assert RETIRED.isdisjoint(ALLOWED_LANES)
    flow_modes = _literal_strings(RouteFlowMode)
    assert RETIRED.isdisjoint(flow_modes), f"RouteFlowMode still has {RETIRED & flow_modes}"
    state_flow = _literal_strings(get_type_hints(AgentRuntimeState)["flow_mode"])
    assert RETIRED.isdisjoint(state_flow), f"state.flow_mode still has {RETIRED & state_flow}"


def test_h1b_intent_parse_routes_and_prompt_lack_retired():
    """H1b: intent_parse VALID_ROUTES + route enum must not teach retired lanes."""
    from app.graph.intent_parse_llm import _STRUCTURED_PARSE_SYSTEM
    from app.graph.intent_parse_schema import VALID_ROUTES

    assert RETIRED.isdisjoint(VALID_ROUTES)
    assert "canvas_agent" in VALID_ROUTES
    route_line = next(
        line for line in _STRUCTURED_PARSE_SYSTEM.splitlines() if '"route":' in line
    )
    for name in RETIRED:
        assert name not in route_line, f"route enum still teaches {name}"
    assert "canvas_agent" in route_line


def test_h2_shim_maps_retired_lanes_to_canvas_agent():
    for lane in RETIRED:
        mapped = parse_decide_lane_json(
            f'{{"lane":"{lane}","confidence":0.9,"reason":"legacy"}}'
        )
        assert mapped is not None
        assert mapped["lane"] == "canvas_agent"
        post = apply_decide_lane_postprocess(
            DecideLaneResult(lane=lane, confidence=0.9, reason="x", clarify_question=None)
        )
        assert post["lane"] == "canvas_agent"


def test_h3_old_soft_names_absent_from_app():
    import app.graph.atomic_intent as ai
    import app.graph.atomic_intent_ir as ir
    import app.graph.intent as intent_mod
    import app.graph.route_features as rf

    for name in (
        "utterance_suggests_atomic_create",
        "atomic_create_intent",
        "atomic_regenerate_intent",
        "classify_atomic_confirm",
    ):
        assert not hasattr(ai, name), name
    assert not hasattr(ir, "intent_suggests_atomic_create")
    assert not hasattr(intent_mod, "single_node_gen_intent")
    assert "has_regen_checkpoint" in rf.RouteFeatures.__annotations__
    assert "has_atomic_checkpoint" not in rf.RouteFeatures.__annotations__
    assert hasattr(ai, "utterance_suggests_media_create")
    assert hasattr(ai, "regen_intent")
    assert hasattr(ir, "intent_suggests_media_create")
    assert hasattr(intent_mod, "focus_gen_intent")


def test_h4_taxonomy_not_ssot_for_retired_flow():
    """H4: loaded taxonomy must not instruct intake to write retired flow_mode."""
    root = Path(__file__).resolve().parents[1] / "skills"
    retired = {"atomic_create", "atomic_regenerate", "single_node"}
    for path in root.rglob("intent-taxonomy.yaml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        routes = data.get("routes") or {}
        for key, body in routes.items():
            if not isinstance(body, dict):
                continue
            fm = body.get("flow_mode")
            assert fm not in retired, f"{path}: routes.{key}.flow_mode={fm}"
        for row in data.get("intake_priority") or []:
            if isinstance(row, dict) and row.get("route") in retired:
                raise AssertionError(f"{path}: intake_priority route={row.get('route')}")


@pytest.mark.asyncio
async def test_h5_checkpoint_regen_clears_split_manifest():
    # Fixture mirrors test_g1_checkpoint_regen / test_precedence_checkpoint_regen.
    intake = make_intake_node(SKILLS_DIR)
    dirty = [
        {
            "asset_id": "hero",
            "node_id": "n-dirty",
            "role": "hero",
            "status": "planned",
        }
    ]
    out = await intake(
        {
            "messages": [HumanMessage(content="重新生成一张")],
            "atomic_node_id": "image-1",
            "atomic_spec": {"target_type": "image", "prompt": "x", "title": "x"},
            "split_manifest": dirty,
        }
    )
    assert out["flow_mode"] == "canvas_agent"
    assert (out.get("route_decision") or {}).get("precedence_rule_id") == "checkpoint_regen"
    assert out["split_manifest"] == []


def test_h6_retired_await_still_safe():
    from app.graph.hitl_resume import RETIRED_INTERRUPT_GATES, build_retired_atomic_confirm_command

    assert "await_atomic_confirm" in RETIRED_INTERRUPT_GATES
    cmd = build_retired_atomic_confirm_command(update={})
    assert "run_atomic_gen" not in str(cmd)
    assert getattr(cmd, "goto", None) in ("parse_sidebar_media", "explore")


def test_h7_no_run_tools_visible():
    from app.tools.tool_plan import build_tool_plan

    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
