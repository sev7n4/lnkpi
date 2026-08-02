"""W22: Structured agent tool errors for LLM self-correction and SSE payloads."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ErrorType = Literal[
    "param_error",
    "permission_denied",
    "tool_timeout",
    "downstream_unavailable",
    "internal_error",
    "circuit_open",
]


class AgentError(TypedDict):
    error_type: ErrorType
    tool_name: str
    message: str
    retry_hint: str


class AgentToolError(Exception):
    """Raised by nest_client (and graph nodes) with a structured AgentError."""

    def __init__(self, error: AgentError) -> None:
        self.error = error
        super().__init__(error["message"])


_RETRY_HINTS: dict[ErrorType, str] = {
    "param_error": "请检查参数后重试",
    "permission_denied": "请确认账号权限或重新登录",
    "tool_timeout": "可稍后重试",
    "downstream_unavailable": "服务暂时不可用，请稍后重试",
    "internal_error": "打开节点「诊断信息」查看详情后重试",
    "circuit_open": "服务繁忙，请稍后再试",
}

_USER_MESSAGES: dict[ErrorType, str] = {
    "tool_timeout": "操作超时，请稍后重试",
    "downstream_unavailable": "下游服务暂时不可用",
    "circuit_open": "服务暂时熔断，请稍后再试",
    "permission_denied": "权限不足，无法完成操作",
    "param_error": "请求参数有误",
    "internal_error": "内部错误，请稍后重试",
}


def retry_hint_for_type(error_type: ErrorType) -> str:
    return _RETRY_HINTS.get(error_type, _RETRY_HINTS["internal_error"])


def is_recoverable_error_type(error_type: ErrorType) -> bool:
    return error_type in ("tool_timeout", "downstream_unavailable", "circuit_open", "internal_error")


def error_type_from_status(status_or_error: str | None) -> ErrorType:
    raw = (status_or_error or "").strip().lower()
    if not raw:
        return "internal_error"
    if "timeout" in raw or "timed out" in raw:
        return "tool_timeout"
    if any(t in raw for t in ("unauthorized", "forbidden", "permission")):
        return "permission_denied"
    if any(t in raw for t in ("fallback_pending", "insufficient", "积分", "points", "policy", "审核", "content_policy")):
        return "param_error"
    if any(t in raw for t in ("5xx", "502", "503", "504", "unavailable", "circuit")):
        return "downstream_unavailable"
    return "internal_error"


def tool_timeout_error(tool_name: str) -> AgentError:
    return {
        "error_type": "tool_timeout",
        "tool_name": tool_name,
        "message": _USER_MESSAGES["tool_timeout"],
        "retry_hint": _RETRY_HINTS["tool_timeout"],
    }


def circuit_open_error(tool_name: str) -> AgentError:
    return {
        "error_type": "circuit_open",
        "tool_name": tool_name,
        "message": _USER_MESSAGES["circuit_open"],
        "retry_hint": _RETRY_HINTS["circuit_open"],
    }


def from_nest_message(tool_name: str, message: str, *, code: int | None = None) -> AgentError:
    lowered = message.lower()
    if code in (401, 403) or "unauthorized" in lowered or "forbidden" in lowered:
        error_type: ErrorType = "permission_denied"
    elif "timeout" in lowered:
        error_type = "tool_timeout"
    elif code and code >= 500:
        error_type = "downstream_unavailable"
    elif code and 400 <= code < 500:
        error_type = "param_error"
    else:
        error_type = error_type_from_status(message)
    return {
        "error_type": error_type,
        "tool_name": tool_name,
        "message": message or _USER_MESSAGES.get(error_type, _USER_MESSAGES["internal_error"]),
        "retry_hint": retry_hint_for_type(error_type),
    }


def from_http_status(tool_name: str, status_code: int) -> AgentError:
    if status_code in (401, 403):
        error_type: ErrorType = "permission_denied"
    elif status_code >= 500:
        error_type = "downstream_unavailable"
    elif status_code >= 400:
        error_type = "param_error"
    else:
        error_type = "internal_error"
    return {
        "error_type": error_type,
        "tool_name": tool_name,
        "message": _USER_MESSAGES.get(error_type, _USER_MESSAGES["internal_error"]),
        "retry_hint": retry_hint_for_type(error_type),
    }


def from_exception(tool_name: str, exc: BaseException) -> AgentError:
    if isinstance(exc, AgentToolError):
        return exc.error
    error_type = error_type_from_status(str(exc))
    return {
        "error_type": error_type,
        "tool_name": tool_name,
        "message": str(exc) or _USER_MESSAGES.get(error_type, _USER_MESSAGES["internal_error"]),
        "retry_hint": retry_hint_for_type(error_type),
    }


def error_to_sse_payload(error: AgentError) -> dict[str, Any]:
    """SSE error event — keeps ``message`` for backward compatibility."""
    return {
        "message": error["message"],
        "error_type": error["error_type"],
        "tool_name": error["tool_name"],
        "retry_hint": error["retry_hint"],
    }


def error_to_task_fields(error: AgentError) -> dict[str, str]:
    return {
        "errorCode": error["error_type"],
        "errorHint": error["retry_hint"],
    }
