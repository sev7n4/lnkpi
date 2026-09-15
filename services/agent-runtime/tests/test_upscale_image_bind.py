from unittest.mock import MagicMock

from app.graph.nodes.explore import _bind_plan_tools
from app.tools.definitions import EXPLORE_WRITE_TOOLS
from app.tools.tool_plan import build_tool_plan


def _bound_names(utterance: str) -> set[str]:
    captured: list[list[str]] = []

    class FakeLlm:
        def bind_tools(self, tools):
            captured.append([getattr(t, "name", "") for t in tools])
            return self

    names = set(EXPLORE_WRITE_TOOLS) | {
        "arrange_nodes_along_edges",
        "upscale_image",
        "get_canvas_layout",
    }
    tools_by_name = {name: MagicMock(name=name) for name in names}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(FakeLlm(), tools_by_name, [], utterance)
    return set(captured[0])


def test_plan_includes_upscale_image():
    assert "upscale_image" in build_tool_plan(loaded=[]).visible_names
    assert "upscale_image" not in EXPLORE_WRITE_TOOLS


def test_bind_keeps_upscale_on_default_and_enlarge():
    assert "upscale_image" in _bound_names("把 prompt-1 的提示词改成猫")
    assert "upscale_image" in _bound_names("把这张图放大")
