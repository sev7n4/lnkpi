import pytest

from app.tools.definitions import build_explore_tools, build_graph_only_tools
from app.tools.tool_registry import EXPLORE_TOOL_NAMES, GRAPH_ONLY_TOOL_NAMES


class _FakeClient:
    pass


class _FakeSidebarClient:
    def __init__(self) -> None:
        self.sidebar_attachments = [
            {"mediaType": "image", "url": "https://cdn.example/a.jpg"}
        ]
        self.calls: list[dict] = []

    async def apply_sidebar_attachments(self, **kwargs):
        self.calls.append(kwargs)
        return {"ok": True, "nodeIds": kwargs.get("node_ids")}


def test_explore_tools_exclude_generation():
    tools = build_explore_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    assert "get_canvas_summary" in names
    assert "cancel_generation" in names
    assert "apply_sidebar_attachments" in names
    assert "focus_nodes" in names
    assert "get_canvas_layout" in names
    assert "duplicate_node" in names
    assert "undo" in names
    assert "open_image_editor" in names
    assert "run_image_generation" not in names
    assert "add_nodes_batch" not in names
    assert "connect_nodes" in names
    assert "upsert_media_node" in names
    assert "propose_generation" in names
    assert "import_workflow" in names
    assert "group_nodes" not in names
    assert "move_nodes" not in names
    assert "apply_layout_ops" not in names
    assert "arrange_nodes_along_edges" in names
    assert "upscale_image" in names
    assert "arrange_nodes_grid" not in names
    assert names <= EXPLORE_TOOL_NAMES


def test_graph_only_includes_generation():
    tools = build_graph_only_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    assert "run_image_generation" in names
    assert "get_canvas_summary" not in names
    assert "add_nodes_batch" in names
    assert "connect_nodes" not in names
    assert "import_workflow" not in names
    assert "arrange_nodes_along_edges" not in names
    assert "upscale_image" not in names
    assert names <= GRAPH_ONLY_TOOL_NAMES


@pytest.mark.asyncio
async def test_s8_apply_sidebar_omits_attachments_uses_nest():
    nest = _FakeSidebarClient()
    tools = build_explore_tools(nest)  # type: ignore[arg-type]
    by_name = {t.name: t for t in tools}
    raw = await by_name["apply_sidebar_attachments"].ainvoke(
        {"node_ids": ["image-1"], "mode": "localRefs", "mentioned_keys": ["I1"]}
    )
    assert nest.calls
    sent = nest.calls[0]
    assert sent["attachments"] == nest.sidebar_attachments
    assert sent["node_ids"] == ["image-1"]
    assert sent.get("mode") == "localRefs"


@pytest.mark.asyncio
async def test_s8_apply_sidebar_empty_returns_error_dict():
    nest = _FakeSidebarClient()
    nest.sidebar_attachments = []
    tools = build_explore_tools(nest)  # type: ignore[arg-type]
    by_name = {t.name: t for t in tools}
    raw = await by_name["apply_sidebar_attachments"].ainvoke(
        {"node_ids": ["image-1"]}
    )
    payload = raw if isinstance(raw, dict) else {}
    if not payload and isinstance(raw, str):
        import json

        payload = json.loads(raw)
    assert payload.get("ok") is False
    assert "侧栏" in str(payload.get("error") or "")
    assert nest.calls == []
