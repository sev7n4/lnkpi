"""P4 + Phase 2: hybrid rule/LLM parse user utterance → atomic_spec."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_parse_llm import llm_parse_atomic_intent
from app.graph.atomic_parse_schema import (
    CLARIFY_THRESHOLD,
    RULE_FAST_PATH_THRESHOLD,
    outcome_from_rule_items,
    parse_outcome_to_state,
    validate_parse_result,
)
from app.graph.atomic_parse_util import load_atomic_parse_few_shots, rule_parse_atomic


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_parse_atomic_intent_node(*, nest: Any | None = None, llm: Any | None = None) -> Callable:
    async def parse_atomic_intent(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        if not text.strip():
            return {
                "phase": "error",
                "last_error": "empty utterance",
                "messages": [AIMessage(content="请描述要生成的内容（如图、文案、视频等）。")],
            }

        canvas_summary = None
        if nest is not None:
            summary_fn = getattr(nest, "get_canvas_summary", None)
            if summary_fn is not None:
                try:
                    canvas_summary = await summary_fn()
                except Exception:  # noqa: BLE001
                    canvas_summary = None

        focus_node_id = state.get("focus_node_id")
        rule_items, rule_conf = rule_parse_atomic(
            text,
            canvas_summary=canvas_summary,
            focus_node_id=focus_node_id,
        )
        canvas_ctx = rule_items[0].get("canvas_context") if rule_items else None

        outcome = None
        if rule_conf >= RULE_FAST_PATH_THRESHOLD:
            outcome = outcome_from_rule_items(
                rule_items,
                confidence=rule_conf,
                reason="rule_fast_path",
            )
        elif llm is not None:
            llm_raw = await llm_parse_atomic_intent(
                llm,
                text,
                canvas_context=canvas_ctx,
                few_shots=load_atomic_parse_few_shots(),
            )
            if llm_raw is not None:
                outcome = validate_parse_result(llm_raw, utterance=text)

        if outcome is None:
            if rule_conf >= CLARIFY_THRESHOLD:
                outcome = outcome_from_rule_items(
                    rule_items,
                    confidence=rule_conf,
                    reason="rule_fallback",
                )
            else:
                outcome = validate_parse_result(
                    {
                        "confidence": rule_conf,
                        "reason": "ambiguous_utterance",
                        "clarify_question": None,
                        "items": [],
                    },
                    utterance=text,
                )

        return parse_outcome_to_state(outcome, canvas_context=canvas_ctx)

    return parse_atomic_intent
