"""Phase C: LLM structured intent parse schema and outcome mapping."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from app.graph.atomic_parse_schema import (
    AtomicParseItem,
    ParseOutcome,
    validate_parse_result,
)
from app.graph.atomic_parse_llm import extract_json_object

VALID_ACTIONS = frozenset({"plan", "write", "generate", "expand", "regenerate", "unknown"})
VALID_SCOPES = frozenset({"atomic", "campaign", "unknown"})
VALID_ROUTES = frozenset(
    {"campaign", "atomic_create", "atomic_regenerate", "single_node", "chat"}
)
VALID_STRUCTURES = frozenset({"single", "multi"})
VALID_TARGET_TYPES = frozenset({"image", "text", "video", "audio", "prompt"})


class IntentParseItem(TypedDict, total=False):
    target_type: str
    title: str
    prompt: str
    confirm_gate: bool
    prompt_mode: str
    pipeline: str
    imageAspect: str
    resolutionBump: bool


class IntentParseResult(TypedDict, total=False):
    action: str
    scope: str
    route: str
    structure: str
    items: list[IntentParseItem]
    confidence: float
    needs_clarify: bool
    clarify_question: str | None
    reason: str


def _clamp_confidence(value: Any) -> float:
    try:
        conf = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, conf))


def _normalize_parse_item(raw: dict[str, Any]) -> IntentParseItem | None:
    target = str(raw.get("target_type") or "").strip()
    if target not in VALID_TARGET_TYPES:
        return None
    prompt = str(raw.get("prompt") or "").strip()
    if not prompt:
        return None
    title = str(raw.get("title") or prompt[:24] or target).strip()
    item: dict[str, Any] = {
        "target_type": target,
        "title": title,
        "prompt": prompt,
    }
    if raw.get("confirm_gate") is not None:
        item["confirm_gate"] = bool(raw["confirm_gate"])
    if raw.get("prompt_mode"):
        item["prompt_mode"] = str(raw["prompt_mode"])
    if raw.get("pipeline"):
        item["pipeline"] = str(raw["pipeline"])
    if raw.get("imageAspect"):
        item["imageAspect"] = str(raw["imageAspect"])
    if raw.get("resolutionBump") is not None:
        item["resolutionBump"] = bool(raw["resolutionBump"])
    return item  # type: ignore[return-value]


def parse_llm_json(raw: str) -> IntentParseResult | None:
    """Parse LLM JSON string into validated IntentParseResult; None if invalid."""
    data = extract_json_object(raw)
    if not isinstance(data, dict):
        return None

    action = str(data.get("action") or "unknown").strip()
    if action not in VALID_ACTIONS:
        action = "unknown"

    scope = str(data.get("scope") or "unknown").strip()
    if scope not in VALID_SCOPES:
        scope = "unknown"

    route = str(data.get("route") or "chat").strip()
    if route not in VALID_ROUTES:
        route = "chat"

    structure = str(data.get("structure") or "single").strip()
    if structure not in VALID_STRUCTURES:
        structure = "single" if structure != "multi" else "multi"

    raw_items = data.get("items")
    items: list[IntentParseItem] = []
    if isinstance(raw_items, list):
        for raw in raw_items:
            if isinstance(raw, dict):
                item = _normalize_parse_item(raw)
                if item is not None:
                    items.append(item)

    confidence = _clamp_confidence(data.get("confidence"))
    needs_clarify = bool(data.get("needs_clarify"))
    clarify_q = data.get("clarify_question")
    clarify_question = str(clarify_q).strip() if clarify_q else None
    reason = str(data.get("reason") or "llm_parse").strip()

    return {
        "action": action,
        "scope": scope,
        "route": route,
        "structure": structure,  # type: ignore[typeddict-item]
        "items": items,
        "confidence": confidence,
        "needs_clarify": needs_clarify,
        "clarify_question": clarify_question,
        "reason": reason,
    }


def _campaign_clarify(result: IntentParseResult) -> ParseOutcome:
    question = result.get("clarify_question") or (
        "这听起来像完整营销/Campaign 方案需求。"
        "请确认是否进入 Campaign 全链路（多节点方案），或说明只要单张/单条原子创作。"
    )
    return {
        "kind": "clarify",
        "confidence": result.get("confidence", 0.0),
        "reason": "llm_route_campaign",
        "clarify_question": question,
    }


def intent_result_to_parse_outcome(
    result: IntentParseResult,
    utterance: str,
) -> ParseOutcome:
    """Map validated IntentParseResult to atomic ParseOutcome for graph state."""
    route = str(result.get("route") or "chat")
    if route == "campaign":
        return _campaign_clarify(result)

    if route in ("atomic_regenerate", "single_node", "chat"):
        question = result.get("clarify_question") or (
            f"我还不太确定「{utterance[:24]}」要如何执行。"
            "请补充是要重新生成、单节点出图，还是其他操作。"
        )
        return {
            "kind": "clarify",
            "confidence": result.get("confidence", 0.0),
            "reason": f"llm_route_{route}",
            "clarify_question": question,
        }

    atomic_items: list[AtomicParseItem] = []
    for item in result.get("items") or []:
        atomic_items.append(dict(item))  # type: ignore[arg-type]

    payload: dict[str, Any] = {
        "structure": result.get("structure") or ("multi" if len(atomic_items) > 1 else "single"),
        "items": atomic_items,
        "confidence": result.get("confidence", 0.0),
        "reason": f"{result.get('action', 'unknown')}:{result.get('reason', 'llm')}",
        "clarify_question": result.get("clarify_question"),
        "needs_clarify": result.get("needs_clarify"),
    }
    return validate_parse_result(payload, utterance=utterance)
