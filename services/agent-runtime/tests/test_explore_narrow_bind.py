"""Tests for plan-based explore bind (narrow-bind keyword cull removed)."""

from app.graph.explore_dispatch import classify_explore_intent
from app.tools.tool_plan import build_tool_plan


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
