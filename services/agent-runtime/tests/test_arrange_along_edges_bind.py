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

    names = set(EXPLORE_WRITE_TOOLS) | {"arrange_nodes_along_edges", "get_canvas_layout"}
    tools_by_name = {name: MagicMock(name=name) for name in names}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(FakeLlm(), tools_by_name, [], utterance)
    return set(captured[0])


def test_plan_includes_arrange_along_edges():
    assert "arrange_nodes_along_edges" in build_tool_plan(loaded=[]).visible_names
    assert "arrange_nodes_along_edges" not in EXPLORE_WRITE_TOOLS


def test_bind_keeps_arrange_on_import_planner_and_default():
    assert "arrange_nodes_along_edges" in _bound_names("请导入工作流到画布")
    assert "arrange_nodes_along_edges" in _bound_names("帮我规划一个角色三视图工作流")
    assert "arrange_nodes_along_edges" in _bound_names("把 prompt-1 的提示词改成猫")
