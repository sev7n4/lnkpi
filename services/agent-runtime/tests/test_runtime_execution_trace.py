"""Task J-3: runtime emits executionTrace in done envelope."""

from __future__ import annotations

from app.runs import _emit_done_execution_trace


def test_done_execution_trace_includes_journey_steps():
    journey_trace = {
        "version": 1,
        "flowMode": "product_visual",
        "steps": [
            {"id": "image_qa", "status": "done", "summary": "检查产品图"},
            {"id": "scheme_draft", "status": "done", "summary": "方案草稿"},
        ],
        "current": "done",
    }
    execution = _emit_done_execution_trace(journey_trace, updated_at=1000)
    assert execution["events"]
    assert execution["updatedAt"] == 1000
    # Should produce at least one event per done step
    assert len(execution["events"]) >= 2


def test_done_execution_trace_handles_missing_journey():
    execution = _emit_done_execution_trace(None, updated_at=2000)
    assert execution == {"events": [], "updatedAt": 2000}


def test_done_execution_trace_event_shape():
    journey_trace = {
        "steps": [
            {"id": "macro_select", "status": "done", "summary": "已选：A、B"},
        ],
        "current": "done",
    }
    execution = _emit_done_execution_trace(journey_trace, updated_at=3000)
    kinds = [e["kind"] for e in execution["events"]]
    assert "journey_step" in kinds
