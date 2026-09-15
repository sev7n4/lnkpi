"""Phase 2: LLM parse fallback tests (node hybrid path retired with atomic_parse)."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessage

from app.graph.atomic_parse_llm import extract_json_object, llm_parse_atomic_intent


class FakeLLM:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls = 0

    async def ainvoke(self, messages):  # noqa: ANN001
        self.calls += 1
        return AIMessage(content=self._content)


def test_extract_json_object_from_codeblock():
    raw = '```json\n{"confidence":0.9,"items":[]}\n```'
    data = extract_json_object(raw)
    assert data is not None
    assert data["confidence"] == 0.9


@pytest.mark.asyncio
async def test_llm_parse_returns_dict():
    payload = {
        "structure": "single",
        "items": [{"target_type": "image", "prompt": "主图", "title": "主图", "confirm_gate": False}],
        "confidence": 0.9,
        "reason": "test",
    }
    llm = FakeLLM(json.dumps(payload))
    data = await llm_parse_atomic_intent(llm, "来一张主图")
    assert data is not None
    assert data["items"][0]["target_type"] == "image"
