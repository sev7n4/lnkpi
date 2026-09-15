from app.graph.nodes.explore import (
    _PLANNER_PROMOTE_LINE,
    _PLANNER_SYSTEM,
    planner_promote_followup,
)


def test_planner_system_uses_user_facing_copy():
    assert "模板" in _PLANNER_SYSTEM
    assert "核心步骤" in _PLANNER_SYSTEM
    assert "不要对用户写" in _PLANNER_SYSTEM
    assert "种子链" in _PLANNER_SYSTEM
    assert "t2i" in _PLANNER_SYSTEM
    assert "i2i" in _PLANNER_SYSTEM
    assert "覆盖上面规则5" in _PLANNER_SYSTEM
    assert "recipe id" in _PLANNER_SYSTEM


def test_planner_system_asks_promote_choice_before_tool():
    assert _PLANNER_PROMOTE_LINE in _PLANNER_SYSTEM
    assert "promote_workflow_template" in _PLANNER_SYSTEM
    assert "needs_seed_confirm" in _PLANNER_SYSTEM


def test_planner_system_arranges_after_instantiate():
    assert "instantiate_workflow_template" in _PLANNER_SYSTEM
    assert "arrange_nodes_along_edges" in _PLANNER_SYSTEM
    assert "addedNodeIds" in _PLANNER_SYSTEM


def test_planner_promote_followup_uses_user_message():
    assert planner_promote_followup({
        "status": "needs_seed_confirm",
        "coreSteps": [{"key": "scene_prompt", "title": "Scene prompt"}],
        "userMessage": "将锁定这些核心步骤：Scene prompt。确认后才会存成新模板。",
    }) == "将锁定这些核心步骤：Scene prompt。确认后才会存成新模板。"
    assert planner_promote_followup({
        "status": "needs_variant_confirm",
        "parentTitle": "电商套图",
        "userMessage": "还是原来那套核心步骤，只记住这次的增减和连线。请确认是否保存为改版。",
    }) == "还是原来那套核心步骤，只记住这次的增减和连线。请确认是否保存为改版。"
    assert planner_promote_followup({"status": "saved", "recipeId": "x"}) is None
