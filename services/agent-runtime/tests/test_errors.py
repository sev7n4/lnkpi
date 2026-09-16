"""Tests for W22 structured agent errors."""

from __future__ import annotations

from app.errors import (
    AgentToolError,
    circuit_open_error,
    error_to_sse_payload,
    error_type_from_status,
    from_exception,
    from_http_status,
    from_nest_message,
    is_recoverable_error_type,
    tool_timeout_error,
)


def test_tool_timeout_error_shape():
    err = tool_timeout_error("runImageGeneration")
    assert err["error_type"] == "tool_timeout"
    assert err["tool_name"] == "runImageGeneration"
    assert err["message"]
    assert err["retry_hint"]


def test_sse_payload_backward_compatible():
    err = circuit_open_error("upsertPromptNode")
    payload = error_to_sse_payload(err)
    assert payload["message"] == err["message"]
    assert payload["error_type"] == "circuit_open"
    assert payload["tool_name"] == "upsertPromptNode"
    assert payload["retry_hint"]


def test_from_http_status_5xx():
    err = from_http_status("connectNodes", 503)
    assert err["error_type"] == "downstream_unavailable"


def test_from_nest_message_permission():
    err = from_nest_message("getNode", "Unauthorized", code=401)
    assert err["error_type"] == "permission_denied"


def test_error_type_from_status_timeout():
    assert error_type_from_status("timeout: hero") == "tool_timeout"


def test_is_recoverable_error_type():
    assert is_recoverable_error_type("tool_timeout") is True
    assert is_recoverable_error_type("param_error") is False


def test_from_exception_wraps_agent_tool_error():
    inner = AgentToolError(tool_timeout_error("waitImageGeneration"))
    err = from_exception("gen", inner)
    assert err["error_type"] == "tool_timeout"


EMPTY_PROMPT = "还有步骤没写提示词，先补上再放到画布。"


def test_message_from_http_error_body_prefers_userMessage():
    from app.errors import message_from_http_error_body

    assert message_from_http_error_body(
        {
            "statusCode": 400,
            "message": {"message": "x", "userMessage": EMPTY_PROMPT},
            "error": "Bad Request",
        },
        "请求参数有误",
    ) == EMPTY_PROMPT


def test_message_from_http_error_body_string_message():
    from app.errors import message_from_http_error_body

    assert message_from_http_error_body({"message": EMPTY_PROMPT}, "请求参数有误") == EMPTY_PROMPT


def test_message_from_http_error_body_fallback():
    from app.errors import message_from_http_error_body

    assert message_from_http_error_body("nope", "请求参数有误") == "请求参数有误"
