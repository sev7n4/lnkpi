"""Phase C: LLM structured intent parse (Action × Scope × Route × Modality)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.graph.atomic_parse_util import atomic_skill_path, load_atomic_parse_few_shots
from app.graph.few_shot import build_llm_messages, load_few_shots
from app.graph.intent_parse_schema import IntentParseResult, parse_llm_json

logger = logging.getLogger(__name__)

LLM_PARSE_TIMEOUT_SEC = 8

_STRUCTURED_PARSE_SYSTEM = """你是 Lnkpi 意图结构化解析器。根据用户 utterance 与上下文，输出 JSON（不要 markdown 代码块）。

输出 schema：
{
  "action": "plan|write|generate|expand|regenerate|unknown",
  "scope": "atomic|campaign|unknown",
  "route": "campaign|atomic_create|atomic_regenerate|single_node|chat",
  "structure": "single|multi",
  "items": [
    {
      "target_type": "image|text|video|audio|prompt",
      "title": "节点标题，≤24字",
      "prompt": "送入 Studio 的完整提示词",
      "confirm_gate": false,
      "prompt_mode": null,
      "pipeline": null
    }
  ],
  "confidence": 0.0,
  "needs_clarify": false,
  "clarify_question": null,
  "reason": "简短中文分类依据"
}

硬约束（与 planning_guard 一致）：
- action=plan 且含「主图+详情页/构图方案」→ route=campaign 或 needs_clarify=true，禁止 items 仅 image 直出
- action=write → route=atomic_create，items 为 text（vision_text 策划文档）
- action=expand → route=atomic_create，items 为 prompt，可带 prompt_mode
- action=generate + 「生成一张/来一张」→ route=atomic_create，target_type=image，confidence≥0.85
- video/audio → confirm_gate=true
- 营销方案/14节点/全链路 → route=campaign，scope=campaign
- multi items >5 → needs_clarify=true，建议 campaign
- 「再生成一张/按刚才风格」→ route=atomic_regenerate 或 needs_clarify（需 checkpoint）
- 意图不清 → confidence<0.7，needs_clarify=true
"""


def load_structured_intent_few_shots(skills_dir: Any = None) -> list[tuple[str, str]]:
    skill = atomic_skill_path(skills_dir)
    shots = load_few_shots(skill).get("parse_intent_structured")
    if shots:
        return shots
    return load_atomic_parse_few_shots(skills_dir)


def _format_context_block(
    *,
    canvas_summary: str | None = None,
    dialogue: str | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> str:
    parts: list[str] = []
    if canvas_summary:
        parts.append(f"[画布摘要] {canvas_summary}")
    if dialogue:
        parts.append(f"[近期对话] {dialogue}")
    if checkpoint:
        parts.append(f"[checkpoint] {json.dumps(checkpoint, ensure_ascii=False)}")
    return "\n".join(parts)


async def llm_parse_intent(
    llm: Any,
    utterance: str,
    *,
    canvas_summary: str | None = None,
    dialogue: str | None = None,
    checkpoint: dict[str, Any] | None = None,
    context_markdown: str | None = None,
    few_shots: list[tuple[str, str]] | None = None,
) -> IntentParseResult | None:
    """Call LLM for structured intent parse; None on failure."""
    if llm is None:
        return None

    shots = few_shots if few_shots is not None else load_structured_intent_few_shots()
    user_block = utterance.strip()
    if context_markdown:
        user_block = f"{user_block}\n\n{context_markdown.strip()}"
    else:
        ctx = _format_context_block(
            canvas_summary=canvas_summary,
            dialogue=dialogue,
            checkpoint=checkpoint,
        )
        if ctx:
            user_block = f"{user_block}\n\n{ctx}"

    messages = build_llm_messages(
        system=_STRUCTURED_PARSE_SYSTEM,
        user=user_block,
        few_shots=shots,
    )

    for attempt in range(2):
        try:
            resp = await llm.ainvoke(messages)
            content = getattr(resp, "content", None) or ""
            parsed = parse_llm_json(str(content))
            if parsed is not None:
                return parsed
            logger.warning("llm_parse_intent invalid JSON (attempt %s)", attempt + 1)
        except Exception as exc:  # noqa: BLE001
            logger.warning("llm_parse_intent failed (attempt %s): %s", attempt + 1, exc)

    return None
