"""DeepSeek thinking-mode helpers for agent ChatOpenAI.

DeepSeek enables thinking by default. With ``tools`` present, every subsequent
request must replay assistant ``reasoning_content`` or the API returns 400.

LangChain ``ChatOpenAI`` does not extract or round-trip ``reasoning_content``.
This module:

1. Patches LangChain converters so ``reasoning_content`` is stored on
   ``AIMessage.additional_kwargs`` and sent back on the next request.
2. Applies ``thinking: enabled|disabled`` (+ optional effort) on ChatOpenAI kwargs.
   Agent default is **disabled**; Dock can turn it on once round-trip is in place.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from langchain_core.messages import AIMessage, BaseMessage

_DEEPSEEK_V4 = re.compile(r"deepseek-v4", re.I)
_DEEPSEEK_FLASH = re.compile(r"(?:^|[/:])deepseek-flash(?:[-./]|$)", re.I)
_DEEPSEEK_ANY = re.compile(r"(?:^|[/:])deepseek(?:[-./]|$)", re.I)

_PATCHED = False


def is_deepseek_chat_model(model: str | None) -> bool:
    if not model:
        return False
    return bool(
        _DEEPSEEK_V4.search(model)
        or _DEEPSEEK_FLASH.search(model)
        or _DEEPSEEK_ANY.search(model)
    )


def deepseek_thinking_extra_body(
    *,
    enabled: bool,
    existing: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    body = dict(existing or {})
    body["thinking"] = {"type": "enabled" if enabled else "disabled"}
    return body


def apply_agent_llm_thinking_policy(
    model: str | None,
    kwargs: dict[str, Any],
    *,
    thinking: bool = False,
    thinking_effort: str | None = None,
) -> dict[str, Any]:
    """Return ChatOpenAI kwargs with DeepSeek thinking policy applied."""
    ensure_reasoning_content_roundtrip()
    out = dict(kwargs)
    resolved = model or (out.get("model") if isinstance(out.get("model"), str) else None)
    if not is_deepseek_chat_model(resolved):
        return out
    out["extra_body"] = deepseek_thinking_extra_body(
        enabled=thinking,
        existing=out.get("extra_body") if isinstance(out.get("extra_body"), Mapping) else None,
    )
    if thinking:
        effort = "max" if thinking_effort == "max" else "high"
        out["reasoning_effort"] = effort
    else:
        out.pop("reasoning_effort", None)
    return out


def ensure_reasoning_content_roundtrip() -> None:
    """Idempotently patch LangChain OpenAI message converters."""
    global _PATCHED
    if _PATCHED:
        return
    import langchain_openai.chat_models.base as oai_base

    orig_to_message = oai_base._convert_dict_to_message
    orig_to_dict = oai_base._convert_message_to_dict

    def _to_message(_dict: Mapping[str, Any]) -> BaseMessage:
        msg = orig_to_message(_dict)
        if isinstance(msg, AIMessage):
            rc = _dict.get("reasoning_content")
            if rc is not None and str(rc):
                msg.additional_kwargs["reasoning_content"] = rc
        return msg

    def _to_dict(
        message: BaseMessage,
        api: str = "chat/completions",
    ) -> dict[str, Any]:
        payload = orig_to_dict(message, api=api)  # type: ignore[arg-type]
        if isinstance(message, AIMessage):
            rc = message.additional_kwargs.get("reasoning_content")
            if rc is not None:
                payload["reasoning_content"] = rc
        return payload

    oai_base._convert_dict_to_message = _to_message  # type: ignore[assignment]
    oai_base._convert_message_to_dict = _to_dict  # type: ignore[assignment]
    _PATCHED = True
