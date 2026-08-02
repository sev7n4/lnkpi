"""W23: OpenTelemetry tracing — LangSmith OTel for LangGraph + manual spans for Nest tools."""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode, Tracer

from app.config import settings

logger = logging.getLogger(__name__)

_tracer: Tracer | None = None
_initialized = False
_langsmith_otel_active = False


def is_tracing_enabled() -> bool:
    if (settings.otel_exporter_otlp_endpoint or "").strip():
        return True
    if settings.langsmith_otel_enabled and (settings.langsmith_api_key or "").strip():
        return True
    return False


def uses_langsmith_otel() -> bool:
    return _langsmith_otel_active


def _apply_tracing_env() -> None:
    endpoint = (settings.otel_exporter_otlp_endpoint or "").strip()
    if endpoint:
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = endpoint
    os.environ["OTEL_SERVICE_NAME"] = settings.otel_service_name

    api_key = (settings.langsmith_api_key or os.environ.get("LANGSMITH_API_KEY") or "").strip()
    if settings.langsmith_otel_enabled:
        os.environ["LANGSMITH_OTEL_ENABLED"] = "true"
        os.environ["LANGSMITH_TRACING"] = "true"
        if api_key:
            os.environ["LANGSMITH_API_KEY"] = api_key
            if settings.langsmith_project:
                os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
            os.environ.pop("LANGSMITH_OTEL_ONLY", None)
        elif endpoint:
            os.environ["LANGSMITH_OTEL_ONLY"] = "true"


def setup_tracing(*, force: bool = False) -> None:
    """Configure LangSmith OTel (LangGraph/LLM) + shared TracerProvider for Nest tools."""
    global _initialized, _tracer, _langsmith_otel_active
    if _initialized and not force:
        return

    if not is_tracing_enabled():
        _tracer = trace.get_tracer(settings.otel_service_name)
        _langsmith_otel_active = False
        _initialized = True
        return

    _apply_tracing_env()

    if settings.langsmith_otel_enabled:
        try:
            from langsmith.integrations.otel import configure as configure_langsmith_otel

            configure_langsmith_otel(project_name=settings.langsmith_project or "lnkpi-agent")
            _langsmith_otel_active = True
            _tracer = trace.get_tracer(settings.otel_service_name)
            _initialized = True
            logger.info(
                "W23 LangSmith OTel enabled endpoint=%s project=%s otel_only=%s",
                settings.otel_exporter_otlp_endpoint or "(langsmith cloud)",
                settings.langsmith_project,
                os.environ.get("LANGSMITH_OTEL_ONLY", "false"),
            )
            return
        except ImportError:
            logger.warning("langsmith[otel] not installed; falling back to manual OTLP exporter")
        except Exception as exc:  # noqa: BLE001
            logger.warning("LangSmith OTel configure failed (%s); falling back to manual OTLP", exc)

    # Fallback: manual OTLP (no LangGraph auto-instrumentation)
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor

    endpoint = (settings.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        _tracer = trace.get_tracer(settings.otel_service_name)
        _initialized = True
        return

    resource = Resource.create(
        {"service.name": settings.otel_service_name, "service.namespace": "lnkpi"}
    )
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint)
    processor = (
        SimpleSpanProcessor(exporter)
        if settings.otel_simple_processor
        else BatchSpanProcessor(exporter)
    )
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer(settings.otel_service_name)
    _langsmith_otel_active = False
    _initialized = True
    logger.info("W23 manual OTLP tracing enabled endpoint=%s", endpoint)


def shutdown_tracing() -> None:
    global _initialized, _tracer, _langsmith_otel_active
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        try:
            provider.shutdown()
        except Exception:
            pass
    _initialized = False
    _tracer = None
    _langsmith_otel_active = False


def reset_tracing_for_tests() -> None:
    global _initialized, _tracer, _langsmith_otel_active
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        try:
            provider.shutdown()
        except Exception:
            pass
    _initialized = False
    _tracer = None
    _langsmith_otel_active = False
    trace._TRACER_PROVIDER = None  # noqa: SLF001 — test isolation


def configure_test_tracing(exporter: Any) -> None:
    """Wire an in-memory exporter for unit tests."""
    global _initialized, _tracer, _langsmith_otel_active
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    _tracer = trace.get_tracer("test", tracer_provider=provider)
    _langsmith_otel_active = False
    _initialized = True


def get_tracer() -> Tracer:
    if _tracer is None:
        setup_tracing()
    return _tracer or trace.get_tracer(settings.otel_service_name)


@contextmanager
def trace_node(node_name: str, *, phase: str | None = None) -> Iterator[None]:
    """Manual node span — skipped when LangSmith OTel auto-instruments LangGraph."""
    if not is_tracing_enabled() or uses_langsmith_otel():
        yield
        return
    attrs: dict[str, str] = {"graph.node": node_name or "unknown"}
    if phase:
        attrs["graph.phase"] = phase
    with get_tracer().start_as_current_span("graph.node", attributes=attrs):
        yield


@contextmanager
def trace_tool(tool_name: str, *, path: str | None = None) -> Iterator[None]:
    if not is_tracing_enabled():
        yield
        return
    attrs: dict[str, str] = {"tool.name": tool_name or "unknown", "langsmith.span.kind": "tool"}
    if path:
        attrs["http.route"] = path
    span_ctx = get_tracer().start_as_current_span("tool.call", attributes=attrs)
    with span_ctx as span:
        try:
            yield
        except Exception as exc:  # noqa: BLE001
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise


def trace_run_attributes(*, thread_id: str, session_id: str, user_id: str) -> dict[str, str]:
    return {
        "agent.thread_id": thread_id,
        "agent.session_id": session_id,
        "agent.user_id": user_id,
        "langsmith.trace.session_id": session_id,
    }


def start_run_span(*, thread_id: str, session_id: str, user_id: str) -> Any:
    if not is_tracing_enabled():
        return None
    return get_tracer().start_span("agent.run", attributes=trace_run_attributes(
        thread_id=thread_id,
        session_id=session_id,
        user_id=user_id,
    ))


def end_run_span(span: Any) -> None:
    if span is not None:
        span.end()
