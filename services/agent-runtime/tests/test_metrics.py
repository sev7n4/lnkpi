"""Tests for W24 Prometheus metrics."""

from __future__ import annotations

from prometheus_client import REGISTRY

from app import metrics


def _sample_value(name: str, labels: dict[str, str] | None = None) -> float:
    value = REGISTRY.get_sample_value(name, labels or {})
    return float(value or 0.0)


def test_thread_gauge_and_counter():
    before_total = _sample_value("agent_threads_total")
    before_active = _sample_value("agent_threads_active")

    metrics.thread_started()
    metrics.thread_started()
    assert _sample_value("agent_threads_total") == before_total + 2
    assert _sample_value("agent_threads_active") == before_active + 2

    metrics.thread_finished()
    assert _sample_value("agent_threads_active") == before_active + 1


def test_node_and_tool_metrics():
    metrics.record_node_executed("await_confirm", 0.12)
    metrics.record_tool_call("getNode", success=True)
    metrics.record_tool_call("getNode", success=False)
    metrics.record_stream_error("tool_timeout")

    assert _sample_value("agent_nodes_executed_total", {"node_name": "await_confirm"}) >= 1
    assert _sample_value("agent_tool_calls_total", {"tool_name": "getNode", "outcome": "success"}) >= 1
    assert _sample_value("agent_tool_calls_total", {"tool_name": "getNode", "outcome": "error"}) >= 1
    assert _sample_value("agent_stream_errors_total", {"error_type": "tool_timeout"}) >= 1


def test_metrics_payload_contains_series():
    payload, content_type = metrics.metrics_payload()
    text = payload.decode()
    assert "agent_threads_total" in text
    assert "explore_dispatch_total" in text
    assert content_type.startswith("text/plain")


def test_explore_dispatch_metrics():
    before = _sample_value("explore_dispatch_total", {"intent": "ui_command", "strategy": "mandatory"})
    metrics.record_explore_dispatch("ui_command", "mandatory")
    metrics.record_explore_dispatch("node_write", "llm")
    assert (
        _sample_value("explore_dispatch_total", {"intent": "ui_command", "strategy": "mandatory"})
        == before + 1
    )
    assert _sample_value("explore_dispatch_total", {"intent": "node_write", "strategy": "llm"}) >= 1
    metrics.record_explore_tool_skipped("lifecycle")
    assert _sample_value("explore_tool_skipped_total", {"intent": "lifecycle"}) >= 1
    metrics.record_explore_route_mismatch(expected="lifecycle", actual="open_query")
    assert (
        _sample_value(
            "explore_route_mismatch_total",
            {"expected": "lifecycle", "actual": "open_query"},
        )
        >= 1
    )


def test_metrics_endpoint(client=None):
    from fastapi.testclient import TestClient

    from app.main import app

    tc = TestClient(app)
    resp = tc.get("/metrics")
    assert resp.status_code == 200
    assert "agent_threads_total" in resp.text
