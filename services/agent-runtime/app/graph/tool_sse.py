"""Best-effort SSE emit for explore/mandatory tool loops."""

from __future__ import annotations

import inspect
import json
import logging
from typing import Any, Literal

logger = logging.getLogger(__name__)

TOOL_SSE_MAX_JSON_BYTES = 2048
_RESULT_KEYS = (
    "ok",
    "error",
    "error_type",
    "status",
    "userMessage",
    "node_id",
    "nodeId",
    "retry_hint",
)
_STR_CLIP = 200
Kind = Literal["arguments", "result"]


def cap_tool_sse_payload(value: Any, *, kind: Kind) -> Any:
    if kind == "arguments":
        obj: Any = value if isinstance(value, dict) else {}
    elif isinstance(value, dict):
        obj = {}
        for key in _RESULT_KEYS:
            if key not in value:
                continue
            item = value[key]
            if key in ("userMessage", "error") and isinstance(item, str):
                obj[key] = item[:_STR_CLIP]
            else:
                obj[key] = item
    else:
        obj = {"repr": str(value)[:_STR_CLIP]}
    return _fit_json(obj)


def _fit_json(obj: Any) -> Any:
    dumped = json.dumps(obj, ensure_ascii=False, default=str)
    if len(dumped.encode("utf-8")) <= TOOL_SSE_MAX_JSON_BYTES:
        return obj
    preview = dumped
    while True:
        wrapped = {"_truncated": True, "preview": preview}
        out = json.dumps(wrapped, ensure_ascii=False, default=str)
        encoded = out.encode("utf-8")
        if len(encoded) <= TOOL_SSE_MAX_JSON_BYTES:
            return wrapped
        raw = preview.encode("utf-8")
        if not raw:
            return {"_truncated": True, "preview": ""}
        preview = raw[: max(0, len(raw) - 64)].decode("utf-8", "ignore")


async def maybe_emit_tool_sse(sink: Any, event: dict[str, Any]) -> None:
    emit = getattr(sink, "_emit", None)
    if not callable(emit):
        return
    try:
        out = emit(event)
        if inspect.isawaitable(out):
            await out
    except Exception:
        logger.debug("tool_sse_emit_failed", exc_info=True)
