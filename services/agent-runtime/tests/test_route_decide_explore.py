from app.graph.route_context import assemble_route_context
from app.graph.route_decide import decide_route


def test_explore_canvas_intent():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "看看画布上有哪些节点，状态怎么样？"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "explore_canvas"
    assert d["reason"] == "explore_canvas_intent"


def test_explore_not_when_atomic_create():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "帮我在画布上生成一张产品主图"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] != "explore_canvas"


def test_explore_lifecycle_diagnostic():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "查一下这个生成任务的失败诊断"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "explore_canvas"


def test_set_node_prompt_before_atomic():
    ctx = assemble_route_context({
        "messages": [{
            "role": "user",
            "content": "查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-测试文案",
        }],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "explore_canvas"
    assert d["flow_mode"] != "atomic_create"


def test_list_user_assets_explore():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "查询我的资产库有哪些素材"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "explore_canvas"


def test_cancel_generation_explore():
    ctx = assemble_route_context({
        "messages": [{"role": "user", "content": "取消 image-16 节点上正在进行的生成任务"}],
    })
    d = decide_route(ctx)
    assert d["flow_mode"] == "explore_canvas"
