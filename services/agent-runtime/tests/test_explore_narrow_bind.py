"""Tests for plan-based explore bind (narrow-bind keyword cull removed)."""

from app.graph.explore_dispatch import classify_explore_intent, select_narrow_write_tools
from app.tools.tool_plan import build_tool_plan

_PLANNER_TOOLS = frozenset({
    "preview_workflow_template",
    "match_workflow_templates",
    "promote_workflow_template",
})
_PLANNER_CONFIRM_TOOLS = _PLANNER_TOOLS | frozenset({"instantiate_workflow_template"})
_IMPORT_ONLY = frozenset({"import_workflow"})


def test_plan_always_includes_import_workflow_in_core():
    plan = build_tool_plan(loaded=[])
    assert "import_workflow" in plan.visible_names
    assert "export_media_package" in plan.visible_names


def test_import_utterance_classifies_as_node_write():
    assert classify_explore_intent("请用 import_workflow 导入工作流到画布") == "node_write"
    assert classify_explore_intent("把工作流导入当前画布") == "node_write"


def test_import_workflow_chinese_with_cdn_url_classifies_node_write():
    utterance = "导入工作流 https://cdn.example/wf.json"
    assert classify_explore_intent(utterance) == "node_write"


def test_plan_visible_ignores_utterance_keywords():
    """Classify may still label intent; bind set must not shrink by keywords."""
    plan = build_tool_plan(loaded=[])
    assert "upload_media_to_canvas" in plan.visible_names
    assert "import_workflow" in plan.visible_names
    assert "set_node_prompt" in plan.visible_names


def test_planner_utterance_binds_preview_and_instantiate_not_only_import():
    tools = select_narrow_write_tools("帮我规划一个电商套图工作流，接到角色三视图")
    assert "preview_workflow_template" in tools
    assert "instantiate_workflow_template" not in tools
    assert "match_workflow_templates" in tools
    assert tools != _IMPORT_ONLY
    assert len(tools) <= 5
    assert tools == _PLANNER_TOOLS


def test_plan_a_workflow_without_consecutive_anchor_binds_planner():
    tools = select_narrow_write_tools("帮我规划一个角色三视图工作流")
    assert tools == _PLANNER_TOOLS
    assert "import_workflow" not in tools
    assert "set_node_prompt" not in tools


def test_confirm_canvas_bind_includes_instantiate():
    tools = select_narrow_write_tools("确认落到画布")
    assert tools == _PLANNER_CONFIRM_TOOLS
    assert "instantiate_workflow_template" in tools


def test_import_workflow_utterance_still_binds_only_import():
    assert select_narrow_write_tools("请用 import_workflow 导入") == _IMPORT_ONLY


def test_planner_keywords_bind_planner_tools():
    for keyword in ("规划工作流", "接到", "改版", "新模板", "存成一套"):
        tools = select_narrow_write_tools(f"请帮我{keyword}")
        assert "preview_workflow_template" in tools
        assert "instantiate_workflow_template" not in tools
        assert tools == _PLANNER_TOOLS
        assert tools != _IMPORT_ONLY


def test_import_workflow_chinese_still_binds_only_import():
    assert select_narrow_write_tools("请导入工作流到画布") == _IMPORT_ONLY
    assert select_narrow_write_tools("导入工作流") == _IMPORT_ONLY


def test_promote_phrases_bind_promote_not_only_import():
    for phrase in ("存成一套新模板", "保存为当前模板的改版"):
        tools = select_narrow_write_tools(phrase)
        assert "promote_workflow_template" in tools
        assert tools != _IMPORT_ONLY
        assert len(tools) <= 5
        assert tools == _PLANNER_TOOLS


def test_live_explore_bind_uses_narrow_planner_writes():
    from unittest.mock import MagicMock
    from app.graph.nodes.explore import _bind_plan_tools
    from app.tools.definitions import EXPLORE_WRITE_TOOLS

    captured: list[list[str]] = []

    class FakeLlm:
        def bind_tools(self, tools):
            captured.append([getattr(t, "name", "") for t in tools])
            return self

    tools_by_name = {name: MagicMock(name=name) for name in EXPLORE_WRITE_TOOLS}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(FakeLlm(), tools_by_name, [], "帮我规划一个角色三视图工作流")
    bound = set(captured[0])
    assert "preview_workflow_template" in bound
    assert "import_workflow" not in bound
    assert "set_node_prompt" not in bound
    assert "instantiate_workflow_template" not in bound
