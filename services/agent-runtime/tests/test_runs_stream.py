"""Smoke test for POST /v1/runs NDJSON streaming with FakeLLM + FakeNest."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from app.main import app, clear_run_overrides, configure_run_overrides

SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"

PLAN_MARKDOWN = """# 卫生洁具企业营销方案

## 定位
高端卫浴电商详情页。

## 视觉资产/白底图
白底产品主图。
"""


class FakeLLM:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    async def ainvoke(self, messages: Any, **kwargs: Any) -> AIMessage:
        if not self.responses:
            raise RuntimeError("FakeLLM: no responses left")
        return AIMessage(content=self.responses.pop(0))


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def close(self) -> None:
        return None

    async def upsert_prompt_node(
        self,
        *,
        prompt: str,
        content: str,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append("upsert_prompt_node")
        nid = node_id or "prompt-plan-1"
        return {
            "nodeId": nid,
            "actions": [
                {
                    "type": "add_node",
                    "payload": {
                        "id": nid,
                        "nodeType": "prompt",
                        "data": {"prompt": prompt, "content": content},
                        "position": {"x": 0, "y": 0},
                    },
                }
            ],
        }

    async def get_node(self, node_id: str) -> dict[str, Any]:
        return {"id": node_id, "type": "prompt", "data": {}}

    async def add_nodes_batch(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        return {"nodes": [], "actions": []}

    async def connect_nodes(self, edges: list[dict[str, Any]]) -> dict[str, Any]:
        return {"actions": []}

    async def set_node_prompt(self, node_id: str, prompt: str) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict[str, Any]:
        return {"nodeId": node_id, "actions": []}

    async def run_image_generation(self, node_id: str) -> dict[str, Any]:
        return {"nodeId": node_id, "status": "completed", "actions": []}


@pytest.fixture(autouse=True)
def _clear_overrides():
    clear_run_overrides()
    yield
    clear_run_overrides()


def test_runs_stream_ndjson_smoke():
    nest = FakeNest()
    llm = FakeLLM(responses=[PLAN_MARKDOWN])
    configure_run_overrides(
        nest=nest,
        llm=llm,
        skills_dir=SKILLS_DIR,
        checkpointer=MemorySaver(),
    )

    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/runs",
        json={
            "session_id": "sess-stream-1",
            "user_id": "user-1",
            "message": "帮我设计一套卫生洁具的营销方案",
            "thread_id": "sess-stream-1",
        },
    ) as response:
        assert response.status_code == 200
        assert "ndjson" in response.headers.get("content-type", "")
        events = [json.loads(line) for line in response.iter_lines() if line]

    types = [e["type"] for e in events]
    assert "canvas_action" in types
    assert "text_delta" in types
    assert "done" in types
    assert "error" not in types
    assert "upsert_prompt_node" in nest.calls

    canvas = next(e for e in events if e["type"] == "canvas_action")
    assert canvas["data"]["type"] == "add_node"
    assert canvas["data"]["payload"]["nodeType"] == "prompt"

    text = "".join(
        e["data"]["text"] for e in events if e["type"] == "text_delta"
    )
    assert "确认" in text or "方案" in text
