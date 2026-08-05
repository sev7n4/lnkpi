"""P4 + Phase 2/C: hybrid rule/LLM structured parse user utterance → atomic_spec."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.config import settings
from app.graph.context_packet import explore_summary_from_packet
from app.graph.atomic_parse_llm import llm_parse_atomic_intent
from app.graph.atomic_context import build_atomic_parse_context, build_atomic_parse_packet
from app.graph.atomic_parse_schema import (
    CLARIFY_THRESHOLD,
    RULE_FAST_PATH_THRESHOLD,
    ParseOutcome,
    outcome_from_rule_items,
    parse_outcome_to_state,
    validate_parse_result,
)
from app.graph.atomic_parse_util import (
    build_variant_spec_from_checkpoint,
    load_atomic_parse_few_shots,
    rule_parse_atomic,
)
from app.graph.atomic_intent import is_regenerate_new_variant
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.intent_parse_llm import LLM_PARSE_TIMEOUT_SEC, llm_parse_intent
from app.graph.intent_parse_schema import IntentParseResult, intent_result_to_parse_outcome
from app.graph.planning_guard import validate_llm_parse
from app.tools.prompt_mode_taxonomy import resolve_prompt_mode

logger = logging.getLogger(__name__)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _log_intent_parse(
    *,
    source: str,
    utterance: str,
    outcome: ParseOutcome | None = None,
    llm_result: IntentParseResult | None = None,
    guard_triggered: bool = False,
) -> None:
    payload: dict[str, Any] = {
        "intent_parse_source": source,
        "utterance_snippet": utterance[:48],
        "guard_triggered": guard_triggered,
    }
    if llm_result:
        payload.update(
            {
                "action": llm_result.get("action"),
                "route": llm_result.get("route"),
                "confidence": llm_result.get("confidence"),
            }
        )
    if outcome:
        payload["outcome_kind"] = outcome.get("kind")
        payload["outcome_reason"] = outcome.get("reason")
    logger.info("intent_parse %s", json.dumps(payload, ensure_ascii=False))


def _apply_prompt_mode_to_result(result: IntentParseResult, utterance: str) -> IntentParseResult:
    mode = resolve_prompt_mode(utterance)
    if not mode:
        return result
    items = []
    for item in result.get("items") or []:
        patched = dict(item)
        if not patched.get("prompt_mode") and not patched.get("promptMode"):
            if str(patched.get("target_type") or "") in ("prompt", "text"):
                patched["prompt_mode"] = mode
        items.append(patched)  # type: ignore[arg-type]
    if items:
        result = dict(result)
        result["items"] = items  # type: ignore[assignment]
    return result


def _outcome_label(outcome: ParseOutcome) -> str:
    if outcome["kind"] == "clarify":
        return f"clarify:{outcome.get('reason', '')}"
    items = outcome.get("items") or []
    if not items:
        return "success:empty"
    types = ",".join(str(i.get("target_type") or "") for i in items)
    return f"success:{types}"


async def _structured_llm_outcome(
    llm: Any,
    text: str,
    *,
    context_markdown: str | None,
    checkpoint: dict[str, Any] | None,
) -> tuple[ParseOutcome | None, IntentParseResult | None, bool]:
    """Returns (outcome, llm_result, guard_triggered)."""
    try:
        raw = await asyncio.wait_for(
            llm_parse_intent(
                llm,
                text,
                context_markdown=context_markdown,
                checkpoint=checkpoint,
            ),
            timeout=LLM_PARSE_TIMEOUT_SEC,
        )
    except TimeoutError:
        logger.warning("llm_parse_intent timeout after %ss", LLM_PARSE_TIMEOUT_SEC)
        return None, None, False

    if raw is None:
        return None, None, False

    raw = _apply_prompt_mode_to_result(raw, text)
    guard = validate_llm_parse(raw, text)
    if guard is not None:
        return guard, raw, True
    return intent_result_to_parse_outcome(raw, text), raw, False


async def _maybe_shadow_diff(
    llm: Any,
    text: str,
    rule_outcome: ParseOutcome,
    *,
    context_markdown: str | None,
    checkpoint: dict[str, Any] | None,
) -> None:
    if not settings.intent_llm_parse_shadow or settings.intent_llm_parse:
        return
    llm_outcome, llm_result, _ = await _structured_llm_outcome(
        llm,
        text,
        context_markdown=context_markdown,
        checkpoint=checkpoint,
    )
    if llm_outcome is None:
        logger.info(
            "intent_parse_shadow diff=llm_unavailable rule=%s",
            _outcome_label(rule_outcome),
        )
        return
    rule_label = _outcome_label(rule_outcome)
    llm_label = _outcome_label(llm_outcome)
    if rule_label != llm_label:
        logger.warning(
            "intent_parse_shadow disagree utterance=%r rule=%s llm=%s llm_route=%s",
            text[:64],
            rule_label,
            llm_label,
            (llm_result or {}).get("route"),
        )
    else:
        logger.info("intent_parse_shadow agree label=%s", rule_label)


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
        context_packet = build_atomic_parse_packet(state, canvas_summary=canvas_summary)
        parse_ctx = build_atomic_parse_context(state, canvas_summary=canvas_summary)
        prior_atomic = state.get("atomic_spec")
        prior_spec = prior_atomic if isinstance(prior_atomic, dict) else None
        checkpoint = {
            "atomic_node_id": state.get("atomic_node_id"),
            "atomic_spec": state.get("atomic_spec"),
        }

        clarify_ctx = state.get("clarify_context") if isinstance(state.get("clarify_context"), dict) else None
        if state.get("phase") == "clarify" and clarify_ctx:
            original = str(clarify_ctx.get("original_utterance") or "")
            question = str(clarify_ctx.get("clarify_question") or state.get("clarify_question") or "")
            classified = classify_clarify_reply(original, question, text, checkpoint=checkpoint)
            if classified != "none":
                classified = _apply_prompt_mode_to_result(classified, original or text)
                reason = str(classified.get("reason") or "")
                validation_u = classified["items"][0]["prompt"] if reason == "clarify_reply_generate_image" else (original or text)
                guard = None if reason == "clarify_reply_generate_image" else validate_llm_parse(classified, original or text)
                outcome = guard or intent_result_to_parse_outcome(classified, validation_u)
                _log_intent_parse(
                    source="clarify_reply",
                    utterance=text,
                    outcome=outcome,
                    llm_result=classified,
                    guard_triggered=guard is not None,
                )
                patch = parse_outcome_to_state(
                    outcome, canvas_context=parse_ctx, prior_spec=prior_spec
                )
                patch.pop("clarify_context", None)
                return patch

        prior_spec = state.get("atomic_spec")
        if (
            is_regenerate_new_variant(text)
            and isinstance(prior_spec, dict)
            and str(state.get("atomic_node_id") or "").strip()
        ):
            variant_spec = build_variant_spec_from_checkpoint(
                text,
                prior_spec,
                canvas_summary=canvas_summary,
                parse_context=parse_ctx or None,
            )
            outcome = outcome_from_rule_items(
                [variant_spec],
                confidence=0.96,
                reason="variant_new_node_from_checkpoint",
            )
            _log_intent_parse(source="rule_variant", utterance=text, outcome=outcome)
            return parse_outcome_to_state(
                outcome, canvas_context=parse_ctx, prior_spec=prior_spec
            )

        canvas_ctx = parse_ctx
        dialogue = None
        outcome: ParseOutcome | None = None
        llm_result: IntentParseResult | None = None
        guard_triggered = False

        if settings.intent_llm_parse and llm is not None:
            outcome, llm_result, guard_triggered = await _structured_llm_outcome(
                llm,
                text,
                context_markdown=parse_ctx or None,
                checkpoint=checkpoint,
            )
            if outcome is None:
                rule_items, rule_conf = rule_parse_atomic(
                    text,
                    canvas_summary=canvas_summary,
                    focus_node_id=focus_node_id,
                    parse_context=parse_ctx or None,
                )
                canvas_ctx = parse_ctx or (rule_items[0].get("canvas_context") if rule_items else None)
                if rule_conf >= CLARIFY_THRESHOLD:
                    outcome = outcome_from_rule_items(
                        rule_items, confidence=rule_conf, reason="rule_fallback_after_llm"
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
                _log_intent_parse(source="rule", utterance=text, outcome=outcome)
            else:
                _log_intent_parse(
                    source="llm",
                    utterance=text,
                    outcome=outcome,
                    llm_result=llm_result,
                    guard_triggered=guard_triggered,
                )
        else:
            rule_items, rule_conf = rule_parse_atomic(
                text,
                canvas_summary=canvas_summary,
                focus_node_id=focus_node_id,
                parse_context=parse_ctx or None,
            )
            canvas_ctx = parse_ctx or (rule_items[0].get("canvas_context") if rule_items else None)
            use_fast_path = not settings.intent_llm_parse_shadow

            if use_fast_path and rule_conf >= RULE_FAST_PATH_THRESHOLD:
                outcome = outcome_from_rule_items(
                    rule_items,
                    confidence=rule_conf,
                    reason="rule_fast_path",
                )
            elif llm is not None and rule_conf < RULE_FAST_PATH_THRESHOLD and not settings.intent_llm_parse:
                llm_raw = await llm_parse_atomic_intent(
                    llm,
                    text,
                    context_markdown=canvas_ctx,
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

            _log_intent_parse(source="rule", utterance=text, outcome=outcome)

            if llm is not None:
                await _maybe_shadow_diff(
                    llm,
                    text,
                    outcome,
                    context_markdown=parse_ctx or None,
                    checkpoint=checkpoint,
                )

        patch = parse_outcome_to_state(
            outcome, canvas_context=canvas_ctx, prior_spec=prior_spec
        )
        patch["explore_summary"] = explore_summary_from_packet(context_packet)
        if settings.agent_thinking_ui and outcome.get("kind") == "items":
            items = outcome.get("items") or []
            if items:
                first = items[0]
                target = str(first.get("target_type") or "内容")
                title = str(first.get("title") or first.get("prompt") or "")[:48]
                patch["thinking_summary"] = f"识别为{target}创作：{title or '未命名'}"
        if outcome["kind"] == "clarify":
            patch["clarify_context"] = {
                "original_utterance": text,
                "clarify_question": outcome.get("clarify_question") or "",
                "clarify_kind": outcome.get("reason") or "unknown",
            }
        return patch

    return parse_atomic_intent
