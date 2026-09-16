"""Explore write-tool narrow bind: planner/import exclusive sets + media-propose set."""

from app.graph.explore_dispatch import classify_explore_intent, select_narrow_write_tools
from app.tools.tool_plan import build_tool_plan

_PLANNER_TOOLS = frozenset({
    "preview_workflow_template",
    "match_workflow_templates",
    "promote_workflow_template",
})
_PLANNER_CONFIRM_TOOLS = _PLANNER_TOOLS | frozenset({"instantiate_workflow_template"})
_IMPORT_ONLY = frozenset({"import_workflow"})
GOLD_BARE_GEN = "帮我生成一张蓝色天空产品主图"
MEDIA_WRITE = frozenset({
    "upsert_media_node",
    "propose_generation",
    "set_node_prompt",
    "attach_refs",
})
GOLD_TRYON = "@I1 模特 @I2 产品，让模特穿上，保持构图不变"
SIDEBAR_MEDIA_WRITE = frozenset({
    "upsert_media_node",
    "apply_sidebar_attachments",
    "set_node_prompt",
    "propose_generation",
})


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
    for phrase in (
        "存成一套新模板",
        "保存为当前模板的改版",
        "确认锁定这些核心步骤",
        "将锁定这些核心步骤：定妆",
        "这份工作流更像哪一种？",
    ):
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


def test_p1_gold_sentence_binds_media_narrow_set():
    tools = select_narrow_write_tools(GOLD_BARE_GEN)
    assert tools == MEDIA_WRITE
    assert len(tools) <= 5


def test_p2_poster_look_does_not_bind_propose():
    tools = select_narrow_write_tools("看看这张海报")
    assert "upsert_media_node" not in tools
    assert "propose_generation" not in tools
    assert tools != MEDIA_WRITE


def test_p3_regen_phrase_does_not_bind_propose():
    tools = select_narrow_write_tools("重新生成一张")
    assert "upsert_media_node" not in tools
    assert "propose_generation" not in tools


def test_campaign_override_does_not_bind_media_set():
    tools = select_narrow_write_tools(GOLD_BARE_GEN + "，做个营销方案")
    assert tools != MEDIA_WRITE
    assert "propose_generation" not in tools


def test_p5_bind_plan_tools_gold_includes_media_writes():
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
    _bind_plan_tools(FakeLlm(), tools_by_name, [], GOLD_BARE_GEN)
    bound = set(captured[0])
    assert "upsert_media_node" in bound
    assert "propose_generation" in bound
    assert "set_node_prompt" in bound
    assert "attach_refs" in bound


def test_utterance_binds_media_propose_gate():
    from app.graph.explore_dispatch import utterance_binds_media_propose

    assert utterance_binds_media_propose(GOLD_BARE_GEN) is True
    assert utterance_binds_media_propose("看看这张海报") is False
    assert utterance_binds_media_propose("重新生成一张") is False
    assert utterance_binds_media_propose(GOLD_BARE_GEN + "，做个营销方案") is False


def test_s1_tryon_gold_with_chips_binds_sidebar_set():
    tools = select_narrow_write_tools(
        GOLD_TRYON,
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    assert tools == SIDEBAR_MEDIA_WRITE
    assert "attach_refs" not in tools
    assert "connect_nodes" not in tools
    assert len(tools) <= 5


def test_s2_tryon_gold_without_chips_does_not_bind_via_chuanshang():
    tools = select_narrow_write_tools(GOLD_TRYON)
    assert tools != SIDEBAR_MEDIA_WRITE
    assert tools != MEDIA_WRITE
    assert "propose_generation" not in tools


def test_s3_implicit_two_new_images_binds_sidebar_set():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=("I1", "I2"),
    )
    assert tools == SIDEBAR_MEDIA_WRITE


def test_s3b_reused_images_without_at_do_not_bind():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
    )
    assert "propose_generation" not in tools
    assert tools != SIDEBAR_MEDIA_WRITE


def test_s3b_thanks_with_old_chips_does_not_bind():
    tools = select_narrow_write_tools(
        "谢谢",
        sidebar_image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
    )
    assert "propose_generation" not in tools


def test_s4_three_new_images_without_at_do_not_bind():
    tools = select_narrow_write_tools(
        "让模特穿上这件衣服",
        sidebar_image_keys=("I1", "I2", "I3"),
        this_turn_new_image_keys=("I1", "I2", "I3"),
    )
    assert "propose_generation" not in tools


def test_s5_what_is_i1_does_not_bind_propose():
    for text in ("@I1 是什么衣服", "I1是什么衣服"):
        tools = select_narrow_write_tools(
            text,
            sidebar_image_keys=("I1", "I2"),
            mentioned_keys=("I1",),
        )
        assert "propose_generation" not in tools
        assert "upsert_media_node" not in tools


def test_s6_planner_plus_chips_stays_planner():
    tools = select_narrow_write_tools(
        "帮我规划一个电商套图工作流，接到角色三视图",
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
        this_turn_new_image_keys=("I1", "I2"),
    )
    assert tools == _PLANNER_TOOLS
    assert "propose_generation" not in tools


def test_s1_bare_gen_plus_chips_uses_sidebar_set_not_attach_refs():
    tools = select_narrow_write_tools(
        GOLD_BARE_GEN,
        sidebar_image_keys=("I1",),
        mentioned_keys=("I1",),
    )
    assert tools == SIDEBAR_MEDIA_WRITE
    assert "attach_refs" not in tools


def test_s7_bare_gen_without_chips_still_media_write():
    assert select_narrow_write_tools(GOLD_BARE_GEN) == MEDIA_WRITE


def test_resolve_sidebar_image_ref_keys_mention_wins_over_empty_new():
    from app.graph.explore_dispatch import resolve_sidebar_image_ref_keys

    assert resolve_sidebar_image_ref_keys(
        image_keys=("I1", "I2"),
        this_turn_new_image_keys=(),
        mentioned_keys=("I2", "I1"),
    ) == ["I2", "I1"]


def test_utterance_binds_sidebar_media_propose_gate():
    from app.graph.explore_dispatch import utterance_binds_sidebar_media_propose

    assert utterance_binds_sidebar_media_propose(GOLD_TRYON, ["I1", "I2"]) is True
    assert utterance_binds_sidebar_media_propose("@I1 是什么衣服", ["I1"]) is False
    assert utterance_binds_sidebar_media_propose("看看这张图", ["I1"]) is False
    assert utterance_binds_sidebar_media_propose(GOLD_TRYON + "，做个营销方案", ["I1", "I2"]) is False
    assert utterance_binds_sidebar_media_propose(GOLD_TRYON, None) is False


def test_chip_armed_look_at_poster_does_not_bind_sidebar_set():
    tools = select_narrow_write_tools(
        "看看这张海报",
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1",),
    )
    assert "propose_generation" not in tools
    assert tools != SIDEBAR_MEDIA_WRITE


def test_chip_armed_regen_does_not_bind_sidebar_set():
    tools = select_narrow_write_tools(
        "重新生成一张",
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    assert "propose_generation" not in tools
    assert tools != SIDEBAR_MEDIA_WRITE


def test_chip_armed_gold_plus_campaign_does_not_bind_sidebar_set():
    tools = select_narrow_write_tools(
        GOLD_TRYON + "，做个营销方案",
        sidebar_image_keys=("I1", "I2"),
        mentioned_keys=("I1", "I2"),
    )
    assert "propose_generation" not in tools
    assert tools != SIDEBAR_MEDIA_WRITE
