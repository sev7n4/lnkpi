import json

import httpx
import pytest

from app.tools.definitions import build_canvas_tools
from app.tools.nest_client import NestCanvasClient

BASE_URL = "http://127.0.0.1:3000/api"
TOKEN = "test-service-token"
SESSION_ID = "session-1"
USER_ID = "user-1"


def _ok(data: dict) -> dict:
    return {"code": 0, "message": "ok", "data": data}


@pytest.fixture
def captured():
    return {"requests": []}


@pytest.fixture
def nest_client(captured):
    async def handler(request: httpx.Request) -> httpx.Response:
        captured["requests"].append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "json": json.loads(request.content.decode()) if request.content else None,
            }
        )
        path = request.url.path
        if path.endswith("/upsert-prompt-node"):
            return httpx.Response(200, json=_ok({"nodeId": "n1", "actions": []}))
        if path.endswith("/get-node"):
            return httpx.Response(200, json=_ok({"id": "n1", "type": "prompt"}))
        if path.endswith("/add-nodes-batch"):
            return httpx.Response(
                200,
                json=_ok({"nodes": [{"key": "hero", "nodeId": "n2"}], "actions": []}),
            )
        if path.endswith("/connect-nodes"):
            return httpx.Response(200, json=_ok({"actions": []}))
        if path.endswith("/set-node-prompt"):
            return httpx.Response(200, json=_ok({"nodeId": "n1"}))
        if path.endswith("/attach-refs"):
            return httpx.Response(200, json=_ok({"nodeId": "n1", "actions": []}))
        if path.endswith("/run-image-generation"):
            return httpx.Response(
                200,
                json=_ok({"url": "https://cdn.example/img.png", "status": "completed", "actions": []}),
            )
        if path.endswith("/get-generation-status"):
            return httpx.Response(200, json=_ok({"status": "completed", "url": "https://cdn.example/img.png"}))
        return httpx.Response(404, json={"code": 404, "message": "not found"})

    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(transport=transport, base_url=BASE_URL)
    client = NestCanvasClient(
        base_url=BASE_URL,
        token=TOKEN,
        session_id=SESSION_ID,
        user_id=USER_ID,
        http_client=http,
    )
    yield client
    return None


def _last(captured):
    return captured["requests"][-1]


@pytest.mark.asyncio
async def test_upsert_prompt_node(nest_client, captured):
    result = await nest_client.upsert_prompt_node(prompt="p", content="c", node_id="n1")
    assert result["nodeId"] == "n1"
    req = _last(captured)
    assert req["url"] == f"{BASE_URL}/agent/internal/upsert-prompt-node"
    assert req["headers"]["x-lnkpi-service-token"] == TOKEN
    assert req["json"] == {
        "sessionId": SESSION_ID,
        "userId": USER_ID,
        "nodeId": "n1",
        "prompt": "p",
        "content": "c",
    }


@pytest.mark.asyncio
async def test_get_node(nest_client, captured):
    result = await nest_client.get_node("n1")
    assert result["id"] == "n1"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "nodeId": "n1"}


@pytest.mark.asyncio
async def test_add_nodes_batch(nest_client, captured):
    items = [{"key": "hero", "title": "Hero", "targetType": "image", "prompt": "hero shot"}]
    result = await nest_client.add_nodes_batch(items)
    assert result["nodes"][0]["nodeId"] == "n2"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "userId": USER_ID, "items": items}


@pytest.mark.asyncio
async def test_connect_nodes(nest_client, captured):
    edges = [{"source": "n1", "target": "n2"}]
    result = await nest_client.connect_nodes(edges)
    assert "actions" in result
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "edges": edges}


@pytest.mark.asyncio
async def test_set_node_prompt(nest_client, captured):
    result = await nest_client.set_node_prompt("n1", "new prompt")
    assert result["nodeId"] == "n1"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "nodeId": "n1", "prompt": "new prompt"}


@pytest.mark.asyncio
async def test_attach_refs(nest_client, captured):
    ref_order = ["n1", "n2"]
    result = await nest_client.attach_refs("n3", ref_order)
    assert result["nodeId"] == "n1"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "nodeId": "n3", "refOrder": ref_order}


@pytest.mark.asyncio
async def test_run_image_generation(nest_client, captured):
    result = await nest_client.run_image_generation("n1")
    assert result["status"] == "completed"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "userId": USER_ID, "nodeId": "n1"}


@pytest.mark.asyncio
async def test_get_generation_status(nest_client, captured):
    result = await nest_client.get_generation_status("n1")
    assert result["status"] == "completed"
    req = _last(captured)
    assert req["json"] == {"sessionId": SESSION_ID, "nodeId": "n1"}


def test_build_canvas_tools_hides_session_and_user(nest_client):
    tools = build_canvas_tools(nest_client)
    names = {tool.name for tool in tools}
    assert "upsert_prompt_node" in names
    assert "get_node" in names
    assert "run_image_generation" in names

    for tool in tools:
        schema = tool.args_schema.model_json_schema()
        props = schema.get("properties", {})
        assert "session_id" not in props
        assert "user_id" not in props
        assert "sessionId" not in props
        assert "userId" not in props
