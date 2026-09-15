from app.graph.nodes.explore import _PLANNER_PROMOTE_LINE, _PLANNER_SYSTEM


def test_planner_system_uses_user_facing_copy():
    assert "模板" in _PLANNER_SYSTEM
    assert "核心步骤" in _PLANNER_SYSTEM
    assert "不要对用户写" in _PLANNER_SYSTEM
    assert "种子链" in _PLANNER_SYSTEM


def test_planner_system_asks_promote_choice_before_tool():
    assert _PLANNER_PROMOTE_LINE in _PLANNER_SYSTEM
    assert "promote_workflow_template" in _PLANNER_SYSTEM


def test_planner_system_arranges_after_instantiate():
    assert "instantiate_workflow_template" in _PLANNER_SYSTEM
    assert "arrange_nodes_along_edges" in _PLANNER_SYSTEM
    assert "addedNodeIds" in _PLANNER_SYSTEM
