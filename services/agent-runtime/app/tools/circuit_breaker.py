"""W21: Per-tool circuit breaker for Nest canvas tool calls."""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class _CircuitEntry:
    failures: int = 0
    open_until: float = 0.0


class CircuitBreaker:
    """Open after ``failure_threshold`` consecutive failures; half-open after cooldown."""

    def __init__(self, *, failure_threshold: int = 5, cooldown_sec: float = 60.0) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_sec = cooldown_sec
        self._entries: dict[str, _CircuitEntry] = {}

    def _entry(self, tool_name: str) -> _CircuitEntry:
        if tool_name not in self._entries:
            self._entries[tool_name] = _CircuitEntry()
        return self._entries[tool_name]

    def is_open(self, tool_name: str) -> bool:
        entry = self._entry(tool_name)
        if entry.open_until <= 0:
            return False
        if time.monotonic() >= entry.open_until:
            entry.open_until = 0.0
            entry.failures = 0
            return False
        return True

    def record_success(self, tool_name: str) -> None:
        entry = self._entry(tool_name)
        entry.failures = 0
        entry.open_until = 0.0

    def record_failure(self, tool_name: str) -> None:
        entry = self._entry(tool_name)
        entry.failures += 1
        if entry.failures >= self.failure_threshold:
            entry.open_until = time.monotonic() + self.cooldown_sec
