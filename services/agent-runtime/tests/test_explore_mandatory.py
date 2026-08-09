"""Integration tests for mandatory explore dispatch (no LLM)."""

import pytest

from app.graph.explore_dispatch import run_mandatory_explore

SUMMARY = {
    "nodes": [
        {"id": "image-1786157513657-20", "title": "换logo李宁"},
        {"id": "image-1786156321418-15", "title": "颜色变体1"},
        {"id": "image-1786156321418-16", "title": "颜色变体2"},
        {"id": "image-16", "title": "demo"},
    ]
}


class FakeTool:
    def __init__(self, name: str, result: dict) -> None:
        self.name = name
        self.result = result
        self.calls: list[dict] = []

    async def ainvoke(self, args: dict) -> dict:
        self.calls.append(args)
        return self.result



@pytest.mark.asyncio
async def test_mandatory_undo_emits_canvas_command():
    tools = {
        "undo": FakeTool("undo", {"ok": True, "canvasCommands": [{"type": "undo"}]}),
    }
    out = await run_mandatory_explore(
        "ui_command",
        "查询画布，撤销上一步画布编辑操作",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["undo"]
    assert out.canvas_commands == [{"type": "undo"}]
    assert tools["undo"].calls == [{}]


@pytest.mark.asyncio
async def test_mandatory_focus_node_by_title():
    tools = {
        "focus_node": FakeTool(
            "focus_node",
            {"ok": True, "canvasCommands": [{"type": "focus_node", "nodeId": "image-1786157513657-20"}]},
        ),
    }
    out = await run_mandatory_explore(
        "ui_command",
        "查询「换logo李宁」节点，把视口定位到它",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["focus_node"]
    assert tools["focus_node"].calls == [{"node_id": "image-1786157513657-20"}]
    assert out.canvas_commands[0]["type"] == "focus_node"


@pytest.mark.asyncio
async def test_mandatory_focus_nodes_range():
    tools = {
        "focus_nodes": FakeTool(
            "focus_nodes",
            {"ok": True, "canvasCommands": [{"type": "focus_nodes", "nodeIds": ["a", "b"]}]},
        ),
    }
    out = await run_mandatory_explore(
        "ui_command",
        "查询颜色变体1到4节点，把视口定位到它们",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["focus_nodes"]
    assert len(tools["focus_nodes"].calls[0]["node_ids"]) >= 2


@pytest.mark.asyncio
async def test_mandatory_lifecycle_requires_node_id():
    out = await run_mandatory_explore(
        "lifecycle",
        "取消正在进行的生成任务",
        summary=SUMMARY,
        tools_by_name={},
    )
    assert out.tools_called == []
    assert "节点 id" in out.reply_text


@pytest.mark.asyncio
async def test_mandatory_cancel_generation():
    tools = {
        "cancel_generation": FakeTool("cancel_generation", {"ok": True}),
    }
    out = await run_mandatory_explore(
        "lifecycle",
        "取消 image-16 节点上正在进行的生成任务",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["cancel_generation"]
    assert tools["cancel_generation"].calls == [{"node_id": "image-16"}]


@pytest.mark.asyncio
async def test_mandatory_list_user_assets():
    tools = {
        "list_user_assets": FakeTool(
            "list_user_assets",
            {"assets": [{"name": "logo.png"}, {"name": "bg.jpg"}]},
        ),
    }
    out = await run_mandatory_explore(
        "asset_read",
        "查询我的资产库有哪些素材，列出名称和类型",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["list_user_assets"]
    assert "logo.png" in out.reply_text
