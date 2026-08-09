"""W24: Prometheus metrics for agent-runtime observability."""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

# Spec O1: key agent metrics with node_name / phase dimensions where useful.
THREADS_TOTAL = Counter("agent_threads_total", "Total agent run streams started")
THREADS_ACTIVE = Gauge("agent_threads_active", "Currently active agent run streams")
NODES_EXECUTED = Counter(
    "agent_nodes_executed_total",
    "LangGraph nodes executed",
    ["node_name"],
)
NODES_DURATION = Histogram(
    "agent_nodes_duration_seconds",
    "LangGraph node execution duration",
    ["node_name"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600),
)
TOOL_CALLS = Counter(
    "agent_tool_calls_total",
    "Nest canvas tool HTTP calls",
    ["tool_name", "outcome"],
)
STREAM_ERRORS = Counter(
    "agent_stream_errors_total",
    "Agent stream terminal errors",
    ["error_type"],
)
EXPLORE_DISPATCH = Counter(
    "explore_dispatch_total",
    "Explore intent dispatch by strategy",
    ["intent", "strategy"],
)
EXPLORE_TOOL_SKIPPED = Counter(
    "explore_tool_skipped_total",
    "Explore mandatory path finished without calling a tool",
    ["intent"],
)
EXPLORE_ROUTE_MISMATCH = Counter(
    "explore_route_mismatch_total",
    "Explore route intent mismatch (reserved for intake compare)",
    ["expected", "actual"],
)
PROMPT_INVOCATIONS = Counter(
    "agent_prompt_invocations_total",
    "LLM prompt template invocations",
    ["skill_id", "prompt_version", "node_name"],
)


def metrics_payload() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST


def thread_started() -> None:
    THREADS_TOTAL.inc()
    THREADS_ACTIVE.inc()


def thread_finished() -> None:
    THREADS_ACTIVE.dec()


def record_node_executed(node_name: str, duration_sec: float) -> None:
    name = node_name or "unknown"
    NODES_EXECUTED.labels(node_name=name).inc()
    NODES_DURATION.labels(node_name=name).observe(max(duration_sec, 0.0))


def record_tool_call(tool_name: str, *, success: bool) -> None:
    outcome = "success" if success else "error"
    TOOL_CALLS.labels(tool_name=tool_name or "unknown", outcome=outcome).inc()


def record_stream_error(error_type: str) -> None:
    STREAM_ERRORS.labels(error_type=error_type or "internal_error").inc()


def record_prompt_invocation(skill_id: str, prompt_version: str, node_name: str) -> None:
    PROMPT_INVOCATIONS.labels(
        skill_id=skill_id or "unknown",
        prompt_version=prompt_version or "unknown",
        node_name=node_name or "unknown",
    ).inc()


def record_explore_dispatch(intent: str, strategy: str) -> None:
    EXPLORE_DISPATCH.labels(intent=intent or "unknown", strategy=strategy or "unknown").inc()


def record_explore_tool_skipped(intent: str) -> None:
    EXPLORE_TOOL_SKIPPED.labels(intent=intent or "unknown").inc()


def record_explore_route_mismatch(*, expected: str, actual: str) -> None:
    EXPLORE_ROUTE_MISMATCH.labels(expected=expected or "unknown", actual=actual or "unknown").inc()


@contextmanager
def track_node(node_name: str) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        record_node_executed(node_name, time.perf_counter() - started)
