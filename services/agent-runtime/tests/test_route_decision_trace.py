"""T18: route_decision execution trace fields."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.config import settings
from app.graph.nodes.intake import make_intake_node
from app.graph.route_trace import route_decision_event, serialize_route_decision
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route
from app.main import app, clear_run_overrides, configure_run_overrides

SKILLS = Path(__file__).resolve().parents[1] / "skills"
AUTH_HEADERS = {"x-lnkpi-service-token": settings.effective_runtime_auth_token}
STYLE3 = "@T1 请按风格3出图"


class FakeNest:
    async def close(self) -> None:
        return None

    async def acquire_thread_lock(self, thread_id: str, holder_id: str, ttl_seconds: float = 300):
        return {"acquired": True}

    async def release_thread_lock(self, thread_id: str, holder_id: str):
        return {"released": True}

    async def renew_thread_lock(self, thread_id: str, holder_id: str, ttl_seconds: float = 300):
        return {"renewed": True}

    async def get_agent_messages(self, *, thread_id: str):
        return []

    async def save_agent_message(self, **kwargs):
        return {"id": "msg-1"}


@pytest.fixture(autouse=True)
def _clear_overrides():
    clear_run_overrides()
    yield
    clear_run_overrides()


def test_serialize_route_decision_includes_trace_fields():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": STYLE3}],
            "sidebar_mentioned_keys": ["T1"],
        }
    )
    raw = decide_route(ctx)
    payload = serialize_route_decision(raw)
    assert payload.get("precedence_rule_id") == "ref_backed_generate"
    assert payload.get("route_features", {}).get("has_text_ref") is True
    intent = payload.get("atomic_intent")
    assert isinstance(intent, dict)
    assert intent.get("action") == "generate"
    assert intent.get("output_modality") == "image"
    assert "T1" in intent.get("mentioned_keys", [])


def test_route_decision_event_shape():
    ctx = assemble_route_context({"messages": [{"role": "user", "content": "你好"}]})
    event = route_decision_event(decide_route(ctx))
    assert event["type"] == "route_decision"
    data = event["data"]
    assert data.get("precedence_rule_id") == "default_chat"
    assert isinstance(data.get("route_decision"), dict)
    assert isinstance(data.get("route_features"), dict)
    assert isinstance(data.get("atomic_intent"), dict)


@pytest.mark.asyncio
async def test_intake_writes_serialized_route_decision():
    intake = make_intake_node(SKILLS)
    out = await intake(
        {
            "messages": [HumanMessage(content=STYLE3)],
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
        }
    )
    decision = out.get("route_decision")
    assert isinstance(decision, dict)
    assert decision.get("precedence_rule_id") == "ref_backed_generate"
    assert decision.get("atomic_intent", {}).get("action") == "generate"
    assert decision.get("route_features", {}).get("has_text_ref") is True


def test_runs_stream_emits_route_decision_trace():
    configure_run_overrides(
        nest=FakeNest(),
        llm=None,
        skills_dir=SKILLS,
        checkpointer=MemorySaver(),
    )
    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/runs",
        headers=AUTH_HEADERS,
        json={
            "session_id": "sess-route-trace",
            "user_id": "user-1",
            "message": STYLE3,
            "thread_id": "sess-route-trace",
            "sidebar_mentioned_keys": ["T1"],
        },
    ) as response:
        assert response.status_code == 200
        events = [json.loads(line) for line in response.iter_lines() if line]

    route_events = [e for e in events if e.get("type") == "route_decision"]
    assert route_events, "expected route_decision SSE event from intake"
    data = route_events[0]["data"]
    assert data.get("precedence_rule_id") == "ref_backed_generate"
    assert data.get("route_features", {}).get("has_text_ref") is True
    assert data.get("atomic_intent", {}).get("output_modality") == "image"
