"""Journey trace snapshot builder for product_visual v2."""

from __future__ import annotations

from datetime import datetime, timezone

from app.graph.product_visual_v2.journey_trace import (
    JOURNEY_STEP_ORDER,
    build_journey_trace_snapshot,
    merge_journey_trace,
    patch_macro_select_step,
)
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import build_presentation_envelope


def test_journey_step_order_matches_stepper():
    from app.graph.product_visual_v2.presentation import STEPPER_ORDER

    assert JOURNEY_STEP_ORDER == STEPPER_ORDER


def test_build_snapshot_macro_select_running():
    snap = build_journey_trace_snapshot(
        {"macro_schemes": [{"id": "A", "label": "湖鲜原境风"}]},
        phase="await_macro_scheme_select",
    )
    assert snap["version"] == 1
    assert snap["flowMode"] == "product_visual"
    assert snap["current"] == "macro_select"
    assert snap["steps"][2]["status"] == "running"
    assert snap["steps"][0]["status"] == "done"
    assert snap["steps"][0]["label"] == "检查产品图"
    assert snap["steps"][2]["label"] == "选宏观风格"


def test_patch_macro_select_step_confirm():
    prev = build_journey_trace_snapshot(
        {
            "macro_schemes": [
                {"id": "A", "label": "湖鲜原境风"},
                {"id": "B", "label": "礼盒臻享风"},
            ],
        },
        phase="await_macro_scheme_select",
    )
    patched = patch_macro_select_step(
        prev,
        schemes=[
            {"id": "A", "label": "湖鲜原境风", "summary": "原境"},
            {"id": "B", "label": "礼盒臻享风", "summary": "礼盒"},
        ],
        selected_ids=["A", "B"],
    )
    macro = next(s for s in patched["steps"] if s["id"] == "macro_select")
    assert macro["status"] == "done"
    assert macro["summary"] == "已选：湖鲜原境风、礼盒臻享风"
    assert macro["snapshot"]["kind"] == "macro_select"
    assert macro["snapshot"]["selectedIds"] == ["A", "B"]
    assert len(macro["snapshot"]["schemes"]) == 2
    assert macro["snapshot"]["schemes"][0]["id"] == "A"
    assert patched["current"] == "ssot_persist"
    assert patched["steps"][0]["status"] == "done"


def test_patch_macro_select_step_skip():
    prev = build_journey_trace_snapshot(
        {"macro_schemes": [{"id": "A", "label": "湖鲜原境风"}]},
        phase="dialog_draft",
    )
    patched = patch_macro_select_step(
        prev,
        schemes=[{"id": "A", "label": "湖鲜原境风"}],
        selected_ids=["A"],
    )
    macro = next(s for s in patched["steps"] if s["id"] == "macro_select")
    assert macro["status"] == "skipped"
    assert macro["summary"] == "仅一套方案，已自动选定"
    assert "snapshot" not in macro


def test_macro_confirm_summary():
    state = {
        "macro_schemes": [
            {"id": "A", "label": "湖鲜原境风"},
            {"id": "B", "label": "礼盒臻享风"},
        ],
        "selected_macro_scheme_ids": ["A", "B"],
    }
    snap = merge_journey_trace(None, state, phase="canvas_ssot_commit")
    macro = next(s for s in snap["steps"] if s["id"] == "macro_select")
    assert macro["status"] == "done"
    assert "湖鲜原境风" in macro["summary"]
    assert "礼盒臻享风" in macro["summary"]
    assert macro["summary"].startswith("已选：")
    assert "__macro_scheme_decision__" not in macro["summary"]
    assert macro["snapshot"]["selectedIds"] == ["A", "B"]
    assert macro["snapshot"]["kind"] == "macro_select"


def test_single_macro_scheme_skipped():
    state = {
        "macro_schemes": [{"id": "A", "label": "湖鲜原境风"}],
        "selected_macro_scheme_ids": ["A"],
    }
    snap = merge_journey_trace(None, state, phase="canvas_ssot_commit")
    macro = next(s for s in snap["steps"] if s["id"] == "macro_select")
    assert macro["status"] == "skipped"
    assert macro["summary"] == "仅一套方案，已自动选定"


def test_done_phase_all_steps_complete():
    fixed = datetime(2026, 8, 13, 4, 0, 0, tzinfo=timezone.utc)
    snap = build_journey_trace_snapshot(
        {"expected_delivery_count": 3},
        phase="done",
        now=fixed,
    )
    assert snap["current"] == "done"
    assert all(s["status"] == "done" for s in snap["steps"])
    assert snap["finishedAt"] is not None
    assert snap["totalMs"] is not None
    assert snap["totalMs"] >= 0


def test_merge_preserves_completed_step_timestamps():
    prev_time = datetime(2026, 8, 13, 4, 0, 0, tzinfo=timezone.utc)
    later = datetime(2026, 8, 13, 4, 5, 0, tzinfo=timezone.utc)
    prev = build_journey_trace_snapshot({}, phase="await_image_qa", now=prev_time)
    image_qa = prev["steps"][0]
    image_qa["status"] = "done"
    image_qa["enteredAt"] = prev_time.isoformat()
    image_qa["completedAt"] = prev_time.isoformat()
    image_qa["summary"] = "识图通过"

    snap = merge_journey_trace(
        prev,
        {"visual_intent": {"primary_goal": "礼盒"}},
        phase="await_macro_scheme_select",
        now=later,
    )
    kept = next(s for s in snap["steps"] if s["id"] == "image_qa")
    assert kept["summary"] == "识图通过"
    assert kept["enteredAt"] == prev_time.isoformat()
    assert kept["completedAt"] == prev_time.isoformat()


def test_presentation_envelope_sets_journey_trace_on_state():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    state = {
        "visual_intent": {"primary_goal": "巨峰葡萄礼盒"},
        "route_context": {"utterance": "帮我做巨峰葡萄礼盒主视觉"},
    }
    build_presentation_envelope(
        kind="callout_info",
        phase="await_image_qa",
        state=state,
        copy=copy,
    )
    trace = state.get("journey_trace")
    assert isinstance(trace, dict)
    assert trace["flowMode"] == "product_visual"
    assert trace["current"] == "image_qa"
    assert len(trace["steps"]) == 9
