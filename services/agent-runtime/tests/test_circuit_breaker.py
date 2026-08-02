"""Tests for W21 circuit breaker."""

from __future__ import annotations

import time

import pytest

from app.errors import AgentToolError
from app.tools.circuit_breaker import CircuitBreaker


def test_opens_after_threshold_failures():
    cb = CircuitBreaker(failure_threshold=3, cooldown_sec=30)
    for _ in range(3):
        cb.record_failure("runImageGeneration")
    assert cb.is_open("runImageGeneration") is True


def test_success_resets_failures():
    cb = CircuitBreaker(failure_threshold=3, cooldown_sec=30)
    cb.record_failure("upsertPromptNode")
    cb.record_failure("upsertPromptNode")
    cb.record_success("upsertPromptNode")
    cb.record_failure("upsertPromptNode")
    assert cb.is_open("upsertPromptNode") is False


def test_half_open_after_cooldown(monkeypatch):
    cb = CircuitBreaker(failure_threshold=2, cooldown_sec=1)
    now = [100.0]

    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    cb.record_failure("getNode")
    cb.record_failure("getNode")
    assert cb.is_open("getNode") is True

    now[0] += 1.5
    assert cb.is_open("getNode") is False


def test_circuit_open_error_is_structured():
    from app.errors import circuit_open_error

    err = circuit_open_error("runImageGeneration")
    assert err["error_type"] == "circuit_open"
    assert err["tool_name"] == "runImageGeneration"
    assert "熔断" in err["message"] or "繁忙" in err["message"]
    exc = AgentToolError(err)
    assert exc.error["retry_hint"]
