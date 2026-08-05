"""Tests for step_copy and step SSE helpers."""

from app.graph.step_copy import (
    NODE_STEP_LABELS,
    phase_hint_event,
    phase_hint_label,
    step_event,
    step_label,
)


def test_step_label_known_nodes():
    assert step_label("parse_atomic_intent") == "解析创作意图"
    assert step_label("unknown_node_xyz") == "处理中"


def test_step_event_payload():
    ev = step_event("intake", status="done", ms=120)
    assert ev["type"] == "step"
    data = ev["data"]
    assert data["id"] == "node:intake"
    assert data["label"] == NODE_STEP_LABELS["intake"]
    assert data["status"] == "done"
    assert data["ms"] == 120


def test_phase_hint_label():
    assert phase_hint_label("await_confirm") == "等待你确认方案"
    assert phase_hint_label(None, "await_topo") == "等待你确认节点结构"


def test_phase_hint_event():
    ev = phase_hint_event(phase="await_confirm")
    assert ev is not None
    assert ev["type"] == "phase_hint"
    assert ev["data"]["label"] == "等待你确认方案"
