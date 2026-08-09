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
- D1：「脚本/广告词/口播稿」→ target_type=text（纯写作，无生成视频/图片）
- D2：video/audio → confirm_gate=true
- **源内容+媒体生成**：「基于文案/提示词/文本生成视频/图片」或 @引用+生成视频/图片 → target_type=video 或 image（「提示词/文案」是来源描述，不是 prompt 节点）
- **扩写 prompt**：「提示词模式/扩写/分镜提示词/三视图提示词/的提示词」且无生成视频/图片 → target_type=prompt
- 「生成一张三视图/三视图各来一张」且无「提示词」→ target_type=image，pipeline=turnaround_image（内部扩写后出图，非原句直出）
- multi：用户要多张/多项时 structure=multi，items 逐条拆分 prompt/title
- 营销方案/14节点/全链路 → confidence<0.7，clarify_question 建议走 Campaign
- 「设计/构图方案/详情页策划/视觉方案」且无「生成一张/来一张」→ needs_clarify 或 target_type=text，confidence<0.7；「主图+详情页+方案」勿直接 image，建议 Campaign
- 明确「生成一张主图/来一张白底图」→ target_type=image，confidence≥0.9
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
    context_markdown: str | None = None,
    few_shots: list[tuple[str, str]] | None = None,
) -> dict[str, Any] | None:
    """Call LLM for structured atomic parse JSON; None on failure."""
    if llm is None:
        return None
    shots = few_shots if few_shots is not None else load_atomic_parse_few_shots()
    user_block = utterance.strip()
    ctx = (context_markdown or canvas_context or "").strip()
    if ctx:
        user_block = f"{user_block}\n\n{ctx}"
    messages = build_llm_messages(system=_PARSE_SYSTEM, user=user_block, few_shots=shots)
    try:
        resp = await llm.ainvoke(messages)
        content = getattr(resp, "content", None) or ""
        return extract_json_object(str(content))
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_parse_atomic_intent failed: %s", exc)
        return None
