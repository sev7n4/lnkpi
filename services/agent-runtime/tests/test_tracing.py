"""Tests for W23 OTLP tracing."""

from __future__ import annotations

import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app import tracing
from app.config import settings


@pytest.fixture(autouse=True)
def _reset_tracing(monkeypatch: pytest.MonkeyPatch):
    tracing.reset_tracing_for_tests()
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "")
    monkeypatch.setattr(settings, "otel_simple_processor", True)
    yield
    tracing.reset_tracing_for_tests()


def test_tracing_disabled_by_default():
    assert tracing.is_tracing_enabled() is False
    with tracing.trace_node("plan"):
        pass
    with tracing.trace_tool("getNode", path="/agent/internal/get-node"):
        pass


def test_trace_node_and_tool_spans(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://127.0.0.1:4318")
    tracing.configure_test_tracing(exporter)

    with tracing.trace_node("await_confirm", phase="await_confirm"):
        with tracing.trace_tool("getNode", path="/agent/internal/get-node"):
            pass

    names = [s.name for s in exporter.get_finished_spans()]
    assert "graph.node" in names
    assert "tool.call" in names


def test_agent_run_span(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://127.0.0.1:4318")
    tracing.configure_test_tracing(exporter)

    span = tracing.get_tracer().start_span(
        "agent.run",
        attributes={
            "agent.thread_id": "t1",
            "agent.session_id": "s1",
            "agent.user_id": "u1",
        },
    )
    span.end()

    spans = exporter.get_finished_spans()
    assert any(s.name == "agent.run" for s in spans)
    run = next(s for s in spans if s.name == "agent.run")
    assert run.attributes.get("agent.thread_id") == "t1"
