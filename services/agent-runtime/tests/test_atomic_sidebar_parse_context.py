"""Atomic parse LLM context includes sidebar media parse block."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node

PARSE_OK = {
    "vision_used": True,
    "user_facing_summary": "不锈钢水杯",
    "fields": {"category": "水杯"},
    "unknown": ["price_band"],
    "image_urls": ["https://cdn.example/cup.jpg"],
    "qa": {
        "product_summary": "不锈钢水杯",
        "is_white_bg": True,
        "is_sharp_enough": True,
        "product_identifiable": True,
    },
}


class FakeLLM:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls = 0
        self.messages = None

    async def ainvoke(self, messages):  # noqa: ANN001
        self.calls += 1
        self.messages = messages
        return AIMessage(content=self._content)


def _joined_prompt(messages) -> str:
    parts: list[str] = []
    for msg in messages or []:
        parts.append(str(getattr(msg, "content", "") or ""))
    return "\n".join(parts)


@pytest.mark.asyncio
async def test_atomic_parse_llm_context_includes_sidebar_parse_block():
    payload = {
        "structure": "single",
        "items": [
            {
                "target_type": "image",
                "prompt": "赛博朋克风耳机",
                "title": "赛博朋克耳机",
                "confirm_gate": False,
            }
        ],
        "confidence": 0.88,
        "reason": "llm",
    }
    llm = FakeLLM(json.dumps(payload))
    node = make_parse_atomic_intent_node(llm=llm)
    await node(
        {
            "messages": [HumanMessage(content="来一张赛博朋克风耳机")],
            "sidebar_media_parse": PARSE_OK,
        }
    )
    assert llm.calls == 1
    prompt = _joined_prompt(llm.messages)
    assert "【侧栏参考图解析】" in prompt
    assert "不锈钢水杯" in prompt
