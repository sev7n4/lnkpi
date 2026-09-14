from app.graph.builder import route_after_intake
from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route


def test_greeting_defaults_to_canvas_agent():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "你好"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "default_chat"
    # Default / alias lanes share the tool-bearing explore node (no zero-tool chat).
    assert route_after_intake({"flow_mode": d["flow_mode"]}) == "explore"
    assert route_after_intake({"flow_mode": "chat"}) == "explore"
    assert route_after_intake({"flow_mode": "explore_canvas"}) == "explore"
    assert route_after_intake({"flow_mode": "canvas_agent"}) == "explore"


def test_canvas_query_routes_canvas_agent():
    """M4: former explore noun signal → canvas_agent (tools via ToolPlan)."""
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "看看画布上有哪些节点，状态怎么样？"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "default_chat"
    assert route_after_intake({"flow_mode": d["flow_mode"]}) == "explore"


def test_explore_not_when_atomic_create():
    """Phase 2a: bare 生成一张… → canvas_agent (atomic_generate retired)."""
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "帮我在画布上生成一张产品主图"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "default_chat"


def test_lifecycle_diagnostic_canvas_agent():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "查一下这个生成任务的失败诊断"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"


def test_set_node_prompt_before_atomic():
    ctx = assemble_route_context({
        "messages": [{
            "role": "user",
            "content": "查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-demo",
        }],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
    assert d["flow_mode"] != "atomic_create"


def test_canvas_copy_node_query_not_atomic_via_wenan():
    """Bare 「文案」must not media_create_high → atomic after explore retirement."""
    for content in (
        "看看画布文案节点",
        "查询 text-40 文案节点，把内容更新为 explore-set-content-测试",
    ):
        ctx = assemble_route_context({
            "messages": [{"role": "user", "content": content}],
        })
        d = decide_route(ctx)
        assert d["flow_mode"] == "canvas_agent", content
        assert d["flow_mode"] != "atomic_create", content
        assert d["precedence_rule_id"] == "default_chat", content


def test_generate_wenan_phase_2a_canvas_agent():
    """Phase 2a: 生成文案 → canvas_agent until propose tools land in 2b."""
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "帮我生成一段耳机卖点文案"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
    assert d["precedence_rule_id"] == "default_chat"


def test_list_user_assets_canvas_agent():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "查询我的资产库有哪些素材"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"


def test_cancel_generation_canvas_agent():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "取消 image-16 节点上正在进行的生成任务"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "canvas_agent"
