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


def test_trace_node_skipped_when_langsmith_otel(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://127.0.0.1:4318")
    tracing.configure_test_tracing(exporter)
    tracing._langsmith_otel_active = True  # noqa: SLF001

    with tracing.trace_node("plan"):
        pass

    assert len(exporter.get_finished_spans()) == 0


def test_normalize_otlp_endpoint():
    assert tracing._normalize_otlp_endpoint("http://tempo:4318") == "http://tempo:4318/v1/traces"
    assert (
        tracing._normalize_otlp_endpoint("http://tempo:4318/v1/traces")
        == "http://tempo:4318/v1/traces"
    )
    assert tracing._normalize_otlp_endpoint("  ") == ""


def test_langsmith_configure_false_falls_back_to_manual_otlp(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://127.0.0.1:4318")
    monkeypatch.setattr(settings, "langsmith_otel_enabled", True)

    def _fake_configure(*_args, **_kwargs):
        return False

    monkeypatch.setattr(
        "langsmith.integrations.otel.configure",
        _fake_configure,
        raising=False,
    )

    tracing.setup_tracing(force=True)
    assert tracing.uses_langsmith_otel() is False
    assert tracing.is_tracing_enabled() is True


def test_agent_run_span(monkeypatch: pytest.MonkeyPatch):
    exporter = InMemorySpanExporter()
    monkeypatch.setattr(settings, "otel_exporter_otlp_endpoint", "http://127.0.0.1:4318")
    tracing.configure_test_tracing(exporter)

    span = tracing.start_run_span(thread_id="t1", session_id="s1", user_id="u1")
    tracing.end_run_span(span)

    spans = exporter.get_finished_spans()
    assert any(s.name == "agent.run" for s in spans)
    run = next(s for s in spans if s.name == "agent.run")
    assert run.attributes.get("agent.thread_id") == "t1"
