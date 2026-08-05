"""Phase C: LLM structured intent parse tests."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessage

from app.graph.intent_parse_llm import llm_parse_intent, load_structured_intent_few_shots


class FakeLLM:
    def __init__(self, content: str) -> None:
        self._content = content
        self.calls = 0

    async def ainvoke(self, messages):  # noqa: ANN001
        self.calls += 1
        return AIMessage(content=self._content)


def test_load_structured_intent_few_shots():
    shots = load_structured_intent_few_shots()
    assert len(shots) >= 1


@pytest.mark.asyncio
async def test_llm_parse_intent_planning_campaign():
    payload = {
        "action": "plan",
        "scope": "campaign",
        "route": "campaign",
        "structure": "single",
        "items": [],
        "confidence": 0.91,
        "needs_clarify": False,
        "clarify_question": None,
        "reason": "主图+详情页构图方案 → Campaign",
    }
    llm = FakeLLM(json.dumps(payload))
    result = await llm_parse_intent(
        llm,
        "请你帮我设计一个蓝牙耳机主图，详情页的构图方案",
    )
    assert result is not None
    assert result["route"] == "campaign"
    assert result["action"] == "plan"
    assert llm.calls == 1


@pytest.mark.asyncio
async def test_llm_parse_intent_retry_on_invalid_json():
    llm = FakeLLM("not json")
    result = await llm_parse_intent(llm, "生成一张主图")
    assert result is None
    assert llm.calls == 2


@pytest.mark.asyncio
async def test_llm_parse_intent_generate_image():
    payload = {
        "action": "generate",
        "scope": "atomic",
        "route": "atomic_create",
        "structure": "single",
        "items": [
            {
                "target_type": "image",
                "title": "主图",
                "prompt": "蓝牙耳机主图",
                "confirm_gate": False,
            }
        ],
        "confidence": 0.94,
        "needs_clarify": False,
        "reason": "明确 generate image",
    }
    llm = FakeLLM(json.dumps(payload))
    result = await llm_parse_intent(llm, "生成一张蓝牙耳机主图")
    assert result is not None
    assert result["items"][0]["target_type"] == "image"
