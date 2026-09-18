"""Task J-4: journey_trace done summary includes deliveryCount (AC-JT-03)."""

from __future__ import annotations

from app.graph.product_visual_v2.journey_trace import build_journey_trace_snapshot


def _make_state(*, delivery_summary: dict | None = None) -> dict:
    return {
        "delivery_summary": delivery_summary,
        "delivery_selections": {},
        "finalized_count": delivery_summary.get("finalized", 0) if delivery_summary else 0,
    }


def test_done_step_summary_includes_delivery_count():
    state = _make_state(delivery_summary={"finalized": 3})
    snap = build_journey_trace_snapshot(state, phase="done")
    # 9th step (index 8) is 'done' step
    done_step = snap["steps"][-1]
    assert done_step["id"] == "done"
    assert "已交付 3 张定稿" in done_step.get("summary", "")


def test_done_step_summary_zero_delivery_keeps_existing_summary():
    state = _make_state(delivery_summary={"finalized": 0})
    snap = build_journey_trace_snapshot(state, phase="done")
    done_step = snap["steps"][-1]
    # No count means no override (don't pollute summary)
    assert "已交付" not in done_step.get("summary", "")


def test_done_step_summary_missing_delivery_state():
    state = _make_state(delivery_summary=None)
    snap = build_journey_trace_snapshot(state, phase="done")
    done_step = snap["steps"][-1]
    assert done_step["id"] == "done"
    assert "summary" not in done_step or "已交付" not in done_step.get("summary", "")
