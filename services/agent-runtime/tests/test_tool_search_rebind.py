from app.tools.tool_plan import build_tool_plan
from app.tools.tool_search import match_deferred_tools


def test_v5_same_turn_loaded_visible():
    loaded: list[str] = []
    assert "list_public_assets" not in build_tool_plan(loaded=loaded).visible_names
    matched = match_deferred_tools("public assets list", limit=5)
    assert "list_public_assets" in matched
    loaded = sorted(set(loaded) | set(matched))
    assert "list_public_assets" in build_tool_plan(loaded=loaded).visible_names
