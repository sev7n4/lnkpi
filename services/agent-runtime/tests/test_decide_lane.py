"""M3b: decide_lane LLM primary behind LNKPI_ROUTE_LLM_PRIMARY."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.config import settings
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route


class FakeLLM:
    def __init__(self, content: str | BaseException) -> None:
        self._content = content
        self.calls = 0
        self.last_messages = None

    def invoke(self, messages):  # noqa: ANN001
        self.calls += 1
        self.last_messages = messages
        if isinstance(self._content, BaseException):
            raise self._content
        return AIMessage(content=self._content)


@pytest.fixture
def primary_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "route_llm_primary", True)


def test_route_llm_flags_default_off():
    assert settings.route_llm_primary is False
    assert settings.route_llm_shadow is False


def test_hard_skips_llm(primary_on):
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "canvas_agent",
                "confidence": 0.99,
                "reason": "should_not_run",
                "clarify_question": None,
            }
        )
    )
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我生成一张蓝牙耳机主图"}]}
    )
    d = decide_route(ctx, llm=llm)
    assert d["flow_mode"] == "atomic_create"
    assert d.get("precedence_rule_id") == "atomic_generate"
    assert llm.calls == 0


def test_llm_failure_falls_back_to_canvas_agent(primary_on):
    llm = FakeLLM(RuntimeError("boom"))
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, llm=llm)
    assert d["flow_mode"] == "canvas_agent"
    assert llm.calls >= 1


def test_primary_uses_llm_when_no_hard(primary_on):
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "canvas_agent",
                "confidence": 0.91,
                "reason": "greeting_via_llm",
                "clarify_question": None,
            }
        )
    )
    msgs = [
        HumanMessage(content="打包导出全部"),
        AIMessage(
            content="已导出",
            tool_calls=[{"name": "export_media_package", "args": {}, "id": "1"}],
        ),
        HumanMessage(content="你好"),
    ]
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(
        ctx,
        llm=llm,
        messages=msgs,
        previous_lane="canvas_agent",
    )
    assert d["flow_mode"] == "canvas_agent"
    assert llm.calls == 1
    assert d.get("reason") == "greeting_via_llm"
    assert d.get("precedence_rule_id") == "decide_lane"
    # D7: compressed recent turns + previous_lane reach the LLM prompt
    blob = " ".join(str(m) for m in (llm.last_messages or []))
    assert "export_media_package" in blob
    assert "canvas_agent" in blob or "previous_lane" in blob.lower()


def test_low_confidence_goes_to_clarify(primary_on):
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "atomic_create",
                "confidence": 0.4,
                "reason": "ambiguous_gen",
                "clarify_question": "要出图还是画布操作？",
            }
        )
    )
    ctx = assemble_route_context(
        {"messages": [{"role": "user", "content": "帮我弄一下那个"}]}
    )
    d = decide_route(ctx, llm=llm)
    assert d["flow_mode"] == "clarify_route"
    assert llm.calls == 1
