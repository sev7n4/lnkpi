"""SSE tool_call/tool_result emit helper (cap + maybe_emit)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.graph.tool_sse import (
    TOOL_SSE_MAX_JSON_BYTES,
    cap_tool_sse_payload,
    maybe_emit_tool_sse,
)


def _dumps_bytes(obj: object) -> int:
    return len(json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"))


def test_cap_result_allowlist_drops_actions():
    out = cap_tool_sse_payload(
        {"ok": True, "nodeId": "n1", "actions": [{"type": "add_node"}]},
        kind="result",
    )
    assert out["ok"] is True
    assert out["nodeId"] == "n1"
    assert "actions" not in out
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES


def test_cap_result_clips_error_to_200():
    out = cap_tool_sse_payload({"error": "e" * 500}, kind="result")
    assert out["error"] == "e" * 200


def test_cap_arguments_non_dict_becomes_empty():
    assert cap_tool_sse_payload("nope", kind="arguments") == {}


def test_t5_cap_result_oversized_truncated():
    out = cap_tool_sse_payload({"retry_hint": "x" * 5000}, kind="result")
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES
    assert out.get("_truncated") is True


def test_t5_cap_arguments_oversized_truncated():
    value = {f"k{i}": "x" * 200 for i in range(50)}
    out = cap_tool_sse_payload(value, kind="arguments")
    assert _dumps_bytes(out) <= TOOL_SSE_MAX_JSON_BYTES
    assert out.get("_truncated") is True


@pytest.mark.asyncio
async def test_maybe_emit_magicmock_sink_does_not_raise():
    await maybe_emit_tool_sse(MagicMock(), {"type": "tool_call", "data": {"name": "undo"}})


@pytest.mark.asyncio
async def test_maybe_emit_missing_emit_noop():
    await maybe_emit_tool_sse(object(), {"type": "tool_call", "data": {"name": "undo"}})


@pytest.mark.asyncio
async def test_maybe_emit_non_awaitable_callable():
    seen: list[dict] = []

    class Sink:
        def _emit(self, event: dict) -> None:
            seen.append(event)

    await maybe_emit_tool_sse(Sink(), {"type": "tool_call", "data": {"name": "undo"}})
    assert seen[0]["data"]["name"] == "undo"


@pytest.mark.asyncio
async def test_maybe_emit_awaitable_and_swallows_errors():
    seen: list[dict] = []

    class Ok:
        async def _emit(self, event: dict) -> None:
            seen.append(event)

    class Boom:
        async def _emit(self, event: dict) -> None:
            raise RuntimeError("sse down")

    await maybe_emit_tool_sse(Ok(), {"type": "tool_call", "data": {"name": "a"}})
    await maybe_emit_tool_sse(Boom(), {"type": "tool_call", "data": {"name": "b"}})
    assert [e["data"]["name"] for e in seen] == ["a"]
