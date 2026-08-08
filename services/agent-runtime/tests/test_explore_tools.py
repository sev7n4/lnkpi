from app.tools.definitions import build_explore_tools, build_graph_only_tools
from app.tools.tool_registry import EXPLORE_TOOL_NAMES, GRAPH_ONLY_TOOL_NAMES


class _FakeClient:
    pass


def test_explore_tools_exclude_generation():
    tools = build_explore_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    assert "get_canvas_summary" in names
    assert "cancel_generation" in names
    assert "run_image_generation" not in names
    assert "add_nodes_batch" not in names
    assert names <= EXPLORE_TOOL_NAMES


def test_graph_only_includes_generation():
    tools = build_graph_only_tools(_FakeClient())  # type: ignore[arg-type]
    names = {t.name for t in tools}
    assert "run_image_generation" in names
    assert "get_canvas_summary" not in names
    assert "add_nodes_batch" in names
    assert names <= GRAPH_ONLY_TOOL_NAMES
