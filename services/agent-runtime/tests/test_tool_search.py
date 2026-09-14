from app.tools.tool_search import match_deferred_tools
from app.tools.tool_registry import DEFERRED_TOOL_NAMES


def test_match_finds_deferred_by_token():
    hit = match_deferred_tools("image edit capabilities", limit=5)
    assert "get_image_edit_capabilities" in hit
    assert set(hit) <= DEFERRED_TOOL_NAMES


def test_match_never_returns_graph_only():
    hit = match_deferred_tools("run_image_generation generation", limit=10)
    assert "run_image_generation" not in hit
