"""Phase C: classify user replies after planning/clarify prompts."""

from __future__ import annotations

from typing import Any, Literal

from app.graph.atomic_clarify import is_affirmative_clarify_reply, is_img2img_utterance
from app.graph.intent_parse_schema import IntentParseResult

ClarifyReplyResult = IntentParseResult | Literal["none"]

_CHOICE_ONE = frozenset({"1", "1）", "一", "单张主图", "单张", "直接出图", "只要主图", "出主图"})
_CHOICE_TWO = frozenset(
    {"2", "2）", "二", "完整方案", "campaign", "全链路", "营销方案", "完整详情页", "详情页方案"}
)
_CHOICE_THREE = frozenset(
    {"3", "3）", "三", "文字策划", "文字版", "不出图", "构图策划", "只要文字", "文字方案"}
)


def _normalize_reply(reply: str) -> str:
    return (reply or "").strip().lower()


def classify_clarify_reply(
    original_utterance: str,
    clarify_question: str,
    user_reply: str,
    *,
    checkpoint: dict[str, Any] | None = None,
) -> ClarifyReplyResult:
    """Map 1/2/3 or natural-language clarify follow-ups to IntentParseResult."""
    del clarify_question, checkpoint  # reserved for future LLM fallback
    raw = (user_reply or "").strip()
    if not raw:
        return "none"

    lowered = _normalize_reply(raw)
    if lowered in _CHOICE_ONE or any(k in raw for k in ("单张主图", "直接出图", "只要主图")):
        prompt = "生成一张蓝牙耳机主图"
        if "蓝牙耳机" in original_utterance:
            prompt = "生成一张蓝牙耳机主图"
        elif "主图" in original_utterance:
            prompt = "生成一张主图"
        return {
            "action": "generate",
            "scope": "atomic",
            "route": "atomic_create",
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "title": prompt[:24],
                    "prompt": prompt,
                    "confirm_gate": False,
                }
            ],
            "confidence": 0.92,
            "needs_clarify": False,
            "reason": "clarify_reply_generate_image",
        }

    if lowered in _CHOICE_TWO or any(
        k in raw for k in ("完整方案", "Campaign", "campaign", "全链路", "营销方案")
    ):
        return {
            "action": "plan",
            "scope": "campaign",
            "route": "campaign",
            "structure": "single",
            "items": [],
            "confidence": 0.90,
            "needs_clarify": False,
            "reason": "clarify_reply_campaign",
        }

    if lowered in _CHOICE_THREE or any(
        k in raw for k in ("文字策划", "不出图", "文字版", "构图策划")
    ):
        prompt = original_utterance.strip() or "视觉构图策划"
        return {
            "action": "write",
            "scope": "atomic",
            "route": "atomic_create",
            "structure": "single",
            "items": [
                {
                    "target_type": "text",
                    "title": "构图策划",
                    "prompt": prompt,
                    "confirm_gate": False,
                    "prompt_mode": "vision_text",
                }
            ],
            "confidence": 0.90,
            "needs_clarify": False,
            "reason": "clarify_reply_vision_text",
        }

    if is_affirmative_clarify_reply(raw) and is_img2img_utterance(original_utterance):
        prompt = original_utterance.strip()
        return {
            "action": "generate",
            "scope": "atomic",
            "route": "atomic_create",
            "structure": "single",
            "items": [
                {
                    "target_type": "image",
                    "title": prompt[:24],
                    "prompt": prompt,
                    "confirm_gate": False,
                }
            ],
            "confidence": 0.94,
            "needs_clarify": False,
            "reason": "clarify_reply_img2img_confirm",
        }

    return "none"
