"""Phase 2: LLM parse fallback tests."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.atomic_parse_llm import extract_json_object, llm_parse_atomic_intent
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node


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


@pytest.mark.asyncio
async def test_hybrid_parse_skips_llm_on_fast_path():
    llm = FakeLLM("{}")
    node = make_parse_atomic_intent_node(llm=llm)
    out = await node({"messages": [HumanMessage(content="帮我生成一个模特人物图")]})
    assert out["phase"] == "atomic_parse"
    assert llm.calls == 0


@pytest.mark.asyncio
async def test_hybrid_parse_clarify_without_llm_on_vague():
    node = make_parse_atomic_intent_node()
    out = await node({"messages": [HumanMessage(content="帮我生成")]})
    assert out["phase"] == "clarify"
    assert out.get("clarify_question")


@pytest.mark.asyncio
async def test_hybrid_parse_uses_llm_when_rule_low_confidence():
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
    out = await node({"messages": [HumanMessage(content="来一张赛博朋克风耳机")]})
    assert llm.calls == 1
    assert out["phase"] == "atomic_parse"
    assert out["atomic_spec"]["prompt"] == "赛博朋克风耳机"
