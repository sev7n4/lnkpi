"""M3b: decide_lane LLM primary behind LNKPI_ROUTE_LLM_PRIMARY."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.config import settings
from app.graph.decide_lane import _invoke_llm
from app.graph.nodes.intake import make_intake_node
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route

SKILLS = Path(__file__).resolve().parents[1] / "skills"


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


class AinvokeOnlyLLM:
    async def ainvoke(self, messages):  # noqa: ANN001, ARG002
        return AIMessage(content="{}")


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


def test_ainvoke_only_raises():
    with pytest.raises(TypeError, match="sync invoke"):
        _invoke_llm(AinvokeOnlyLLM(), [{"role": "user", "content": "x"}])


@pytest.mark.asyncio
async def test_intake_wires_llm_on_soft_path(primary_on):
    """Production intake must pass llm so primary soft path actually calls decide_lane."""
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "canvas_agent",
                "confidence": 0.88,
                "reason": "intake_wired_llm",
                "clarify_question": None,
            }
        )
    )
    intake = make_intake_node(SKILLS, llm=llm)
    out = await intake(
        {
            "messages": [HumanMessage(content="你好")],
            "previous_lane": "canvas_agent",
        }
    )
    assert llm.calls == 1
    assert out["flow_mode"] == "canvas_agent"
    assert out.get("previous_lane") == "canvas_agent"
    assert (out.get("route_decision") or {}).get("reason") == "intake_wired_llm"


def test_primary_soft_campaign_without_skill_clarifies(primary_on):
    """decide_lane campaign with no resolvable skill must not fall through to explore."""
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "campaign",
                "confidence": 0.9,
                "reason": "llm_wants_campaign",
                "clarify_question": None,
            }
        )
    )
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, llm=llm, valid_skill_ids=set())
    assert d["flow_mode"] == "clarify_route"
    assert d.get("reason") == "skill_required_without_skill"
    assert d.get("clarify_question")


def test_primary_soft_sets_guard_veto_on_canvas_agent(primary_on, monkeypatch):
    """Soft path must populate guard_veto (not always None)."""
    from app.graph import route_decide as rd

    monkeypatch.setattr(rd, "_guard_veto", lambda _ctx: "planning_image_conflict")
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "canvas_agent",
                "confidence": 0.9,
                "reason": "safe_agent",
                "clarify_question": None,
            }
        )
    )
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, llm=llm)
    assert d["flow_mode"] == "canvas_agent"
    assert d.get("guard_veto") == "planning_image_conflict"


def test_primary_soft_guard_vetoes_graph_lane(primary_on, monkeypatch):
    """Guard veto on a graph lane → clarify_route (precedence orch_ambiguous semantics)."""
    from app.graph import route_decide as rd

    monkeypatch.setattr(rd, "_guard_veto", lambda _ctx: "planning_image_conflict")
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "atomic_create",
                "confidence": 0.9,
                "reason": "llm_atomic",
                "clarify_question": None,
            }
        )
    )
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    d = decide_route(ctx, llm=llm)
    assert d["flow_mode"] == "clarify_route"
    assert d.get("guard_veto") == "planning_image_conflict"
    assert d.get("reason") == "planning_guard_veto"


@pytest.mark.asyncio
async def test_intake_campaign_without_skill_clarifies_not_explore(primary_on):
    """Skill-less campaign (LLM soft path) → clarify, never explore sink."""
    llm = FakeLLM(
        json.dumps(
            {
                "lane": "campaign",
                "confidence": 0.92,
                "reason": "llm_campaign",
                "clarify_question": None,
            }
        )
    )
    intake = make_intake_node(SKILLS, llm=llm)
    out = await intake({"messages": [HumanMessage(content="你好")]})
    assert out.get("skill_id") is None
    assert out.get("phase") == "clarify"
    assert out.get("route_clarify") is True
    assert out["flow_mode"] != "campaign"
    assert out.get("clarify_question")


@pytest.mark.asyncio
async def test_intake_safety_net_skill_required_clarify(monkeypatch):
    """Intake safety: campaign without skill_id → SKILL_REQUIRED_CLARIFY."""
    from app.graph.nodes import intake as intake_mod
    from app.graph.nodes.intake import SKILL_REQUIRED_CLARIFY

    monkeypatch.setattr(
        intake_mod,
        "decide_route",
        lambda *a, **k: {
            "flow_mode": "campaign",
            "l0_action": "unknown",
            "confidence": 0.9,
            "reason": "forced_campaign",
            "clarify_question": None,
            "guard_veto": None,
            "is_modify": False,
            "precedence_rule_id": "test",
        },
    )
    monkeypatch.setattr(
        intake_mod,
        "serialize_route_decision",
        lambda d: d,
    )
    intake = make_intake_node(SKILLS, llm=None)
    out = await intake({"messages": [HumanMessage(content="做个详情页方案")]})
    assert out.get("phase") == "clarify"
    assert out.get("route_clarify") is True
    assert out.get("skill_id") is None
    assert out["flow_mode"] != "campaign"
    assert out.get("clarify_question") == SKILL_REQUIRED_CLARIFY
