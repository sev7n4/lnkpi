import pytest

from app.graph.nodes.explore import _direct_undo_redo, _resolve_node_id_by_title


class FakeTool:
    def __init__(self, result: dict) -> None:
        self.result = result
        self.calls = 0

    async def ainvoke(self, _args: dict) -> dict:
        self.calls += 1
        return self.result


@pytest.mark.asyncio
async def test_direct_undo_when_llm_skipped():
    undo = FakeTool({"ok": True, "canvasCommands": [{"type": "undo"}]})
    tools = {"undo": undo}
    out = await _direct_undo_redo("查询画布，撤销上一步画布编辑操作", tools, set(), [])
    assert out == [{"type": "undo"}]
    assert undo.calls == 1


def test_resolve_node_id_by_title():
    summary = {
        "nodes": [
            {"id": "image-1786157513657-20", "title": "换logo李宁", "type": "image", "status": "completed"},
        ],
    }
    assert _resolve_node_id_by_title(summary, "换logo李宁") == "image-1786157513657-20"
