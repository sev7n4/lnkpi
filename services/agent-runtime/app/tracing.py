"""W23: OpenTelemetry OTLP tracing for agent-runtime (thread → node → tool → llm)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager, contextmanager
from typing import Any, AsyncIterator, Iterator

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
from opentelemetry.trace import Status, StatusCode, Tracer

from app.config import settings

logger = logging.getLogger(__name__)

_tracer: Tracer | None = None
_initialized = False


def is_tracing_enabled() -> bool:
    return bool((settings.otel_exporter_otlp_endpoint or "").strip())


def setup_tracing(*, force: bool = False) -> None:
    """Configure OTLP HTTP exporter. No-op when endpoint unset."""
    global _initialized, _tracer
    if _initialized and not force:
        return
    endpoint = (settings.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        _tracer = trace.get_tracer(settings.otel_service_name)
        _initialized = True
        return

    resource = Resource.create(
        {
            "service.name": settings.otel_service_name,
            "service.namespace": "lnkpi",
        }
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
    _initialized = True
    logger.info("W23 OTLP tracing enabled endpoint=%s", endpoint)


def shutdown_tracing() -> None:
    global _initialized, _tracer
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()
    _initialized = False
    _tracer = None


def reset_tracing_for_tests() -> None:
    """Reset global tracing state between tests."""
    global _initialized, _tracer
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        try:
            provider.shutdown()
        except Exception:
            pass
    _initialized = False
    _tracer = None
    trace._TRACER_PROVIDER = None  # noqa: SLF001 — test isolation


def configure_test_tracing(exporter: Any) -> None:
    """Wire an in-memory exporter for unit tests (no global provider override)."""
    global _initialized, _tracer
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    _tracer = trace.get_tracer("test", tracer_provider=provider)
    _initialized = True


def get_tracer() -> Tracer:
    if _tracer is None:
        setup_tracing()
    return _tracer or trace.get_tracer(settings.otel_service_name)


@contextmanager
def trace_node(node_name: str, *, phase: str | None = None) -> Iterator[None]:
    if not is_tracing_enabled():
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
    attrs: dict[str, str] = {"tool.name": tool_name or "unknown"}
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


@asynccontextmanager
async def trace_run(
    *,
    thread_id: str,
    session_id: str,
    user_id: str,
) -> AsyncIterator[None]:
    if not is_tracing_enabled():
        yield
        return
    attrs = {
        "agent.thread_id": thread_id,
        "agent.session_id": session_id,
        "agent.user_id": user_id,
    }
    span_ctx = get_tracer().start_as_current_span("agent.run", attributes=attrs)
    with span_ctx as span:
        try:
            yield
        except Exception as exc:  # noqa: BLE001
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise


def trace_llm_handler(model: str) -> Any:
    """LangChain async callback that records llm.invoke spans."""
    from langchain_core.callbacks.base import AsyncCallbackHandler

    class _Handler(AsyncCallbackHandler):
        def __init__(self) -> None:
            self._spans: dict[str, Any] = {}

        async def on_llm_start(
            self,
            serialized: dict[str, Any],
            prompts: list[str],
            *,
            run_id: Any,
            **kwargs: Any,
        ) -> None:
            if not is_tracing_enabled():
                return
            span = get_tracer().start_span(
                "llm.invoke",
                attributes={"llm.model": model or "unknown"},
            )
            self._spans[str(run_id)] = span

        async def on_llm_end(self, response: Any, *, run_id: Any, **kwargs: Any) -> None:
            span = self._spans.pop(str(run_id), None)
            if span is not None:
                span.end()

        async def on_llm_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
            span = self._spans.pop(str(run_id), None)
            if span is not None:
                span.record_exception(error)
                span.set_status(Status(StatusCode.ERROR, str(error)))
                span.end()

    return _Handler()
