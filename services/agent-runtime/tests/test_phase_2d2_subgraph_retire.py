"""Phase 2d.2 §6.0.7: retire atomic/single subgraphs (G1–G5, G7)."""

from __future__ import annotations

from app.graph.atomic_intent_ir import resolve_atomic_intent
from app.graph.builder import build_agent_graph, route_after_intake
from app.graph.decide_lane import (
    ALLOWED_LANES,
    DecideLaneResult,
    apply_decide_lane_postprocess,
    parse_decide_lane_json,
)
from app.graph.route_context import assemble_route_context
from app.graph.route_features import extract_route_features
from app.graph.route_precedence import apply_route_precedence

FORBIDDEN_NODES = frozenset({
    "parse_atomic_intent",
    "create_atomic_node",
    "await_atomic_confirm",
    "run_atomic_gen",
    "prepare_atomic_regenerate",
    "adjust_atomic_regenerate",
    "prepare_single_gen",
})


def _precedence(state: dict):
    ctx = assemble_route_context(state)
    intent = resolve_atomic_intent(
        ctx["utterance"],
        mentioned_keys=list(ctx.get("mentioned_keys") or []),
    )
    features = extract_route_features(ctx, intent)
    return apply_route_precedence(intent, features, ctx)


def test_g1_checkpoint_regen_routes_canvas_agent():
    # Fixture mirrors test_route_precedence.test_precedence_checkpoint_regen
    # so has_atomic_checkpoint + regenerate intent fire checkpoint_regen.
    d = _precedence(
        {
            "messages": [{"role": "user", "content": "重新生成一张"}],
            "atomic_node_id": "image-1",
            "atomic_spec": {"target_type": "image", "prompt": "x", "title": "x"},
        }
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "checkpoint_regen"


def test_g2_focus_gen_routes_canvas_agent():
    # Utterance must match single_node_gen_intent (see test_precedence_focus_gen:
    # "快速生成"); "生成这个节点" does not fire focus_gen today.
    d = _precedence(
        {
            "messages": [{"role": "user", "content": "快速生成"}],
            "focus_node_id": "image-99",
        }
    )
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "focus_gen"


def test_g3_legacy_flow_modes_route_to_explore():
    for mode in ("atomic_create", "atomic_regenerate", "single_node"):
        assert route_after_intake({"flow_mode": mode}) == "explore"


def test_g4_compiled_graph_lacks_atomic_single_nodes():
    class _Nest:
        pass

    g = build_agent_graph(nest=_Nest(), llm=None, skills_dir="services/agent-runtime/skills")
    names = set(g.get_graph().nodes)
    missing = FORBIDDEN_NODES & names
    assert not missing, f"still registered: {sorted(missing)}"


def test_g5_decide_lane_maps_retired_lanes():
    assert "atomic_regenerate" not in ALLOWED_LANES
    assert "single_node" not in ALLOWED_LANES
    assert "atomic_create" not in ALLOWED_LANES
    for lane in ("atomic_create", "atomic_regenerate", "single_node"):
        mapped = parse_decide_lane_json(
            f'{{"lane":"{lane}","confidence":0.9,"reason":"legacy_llm"}}'
        )
        assert mapped is not None
        assert mapped["lane"] == "canvas_agent"
        post = apply_decide_lane_postprocess(
            DecideLaneResult(
                lane=lane, confidence=0.9, reason="x", clarify_question=None
            )
        )
        assert post["lane"] == "canvas_agent"


def test_g7_no_run_tools_visible():
    from app.tools.tool_plan import build_tool_plan

    plan = build_tool_plan()
    assert "run_image_generation" not in plan.visible_names
    assert "run_video_generation" not in plan.visible_names
