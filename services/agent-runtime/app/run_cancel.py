from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_flags: dict[str, dict[str, Any]] = {}


def request_cancel(thread_id: str, *, reason: str = "user") -> None:
    tid = (thread_id or "").strip()
    if not tid:
        return
    with _lock:
        _flags[tid] = {"reason": reason or "user"}


def is_cancel_requested(thread_id: str) -> bool:
    tid = (thread_id or "").strip()
    if not tid:
        return False
    with _lock:
        return tid in _flags


def peek_cancel_reason(thread_id: str) -> str | None:
    tid = (thread_id or "").strip()
    if not tid:
        return None
    with _lock:
        entry = _flags.get(tid)
        return str(entry["reason"]) if entry else None


def clear_cancel(thread_id: str) -> None:
    tid = (thread_id or "").strip()
    if not tid:
        return
    with _lock:
        _flags.pop(tid, None)
