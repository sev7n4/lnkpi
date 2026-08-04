"""Phase 2: LLM structured parse fallback for atomic intent."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.graph.few_shot import build_llm_messages
from app.graph.atomic_parse_util import load_atomic_parse_few_shots

logger = logging.getLogger(__name__)

_PARSE_SYSTEM = """你是 Atomic Studio 意图解析器。根据用户一句话，输出 JSON（不要 markdown 代码块）。

输出 schema：
{
  "structure": "single" | "multi",
  "items": [
    {
      "target_type": "image|text|video|audio|prompt",
      "title": "节点标题，≤20字",
      "prompt": "送入 Studio 的完整提示词",
      "confirm_gate": false
    }
  ],
  "confidence": 0.0,
  "reason": "一句话分类依据",
  "clarify_question": null
}

规则：
- D1：「分镜提示词/脚本/广告词/文案」→ target_type=text（不是 prompt）
- D2：video/audio → confirm_gate=true
- target_type=prompt：用户要「生成/写…提示词」、三视图/四视图/多视图提示词、提示词模式扩写（产出 prompt 节点 content，不是直接出图）
- 「生成一张三视图/三视图各来一张」且无「提示词」→ target_type=image（直接出图）
- multi：用户要多张/多项时 structure=multi，items 逐条拆分 prompt/title
- 营销方案/14节点/全链路 → confidence<0.7，clarify_question 建议走 Campaign
- 意图不清（如仅「帮我生成」）→ confidence<0.7 并给出 clarify_question
- 「再生成一张/按刚才风格/重新生成」→ 非首轮 create parse；confidence<0.5，clarify 引导同会话 regenerate/变体（勿判 Campaign）
"""


def extract_json_object(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = text.split("\n", 1)[-1] if "\n" in text else text.strip("`")
        if text.endswith("```"):
            text = text[: -3].rstrip()
        text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def llm_parse_atomic_intent(
    llm: Any,
    utterance: str,
    *,
    canvas_context: str | None = None,
    few_shots: list[tuple[str, str]] | None = None,
) -> dict[str, Any] | None:
    """Call LLM for structured atomic parse JSON; None on failure."""
    if llm is None:
        return None
    shots = few_shots if few_shots is not None else load_atomic_parse_few_shots()
    user_block = utterance.strip()
    if canvas_context:
        user_block = f"{user_block}\n\n[画布上下文] {canvas_context}"
    messages = build_llm_messages(system=_PARSE_SYSTEM, user=user_block, few_shots=shots)
    try:
        resp = await llm.ainvoke(messages)
        content = getattr(resp, "content", None) or ""
        return extract_json_object(str(content))
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_parse_atomic_intent failed: %s", exc)
        return None
