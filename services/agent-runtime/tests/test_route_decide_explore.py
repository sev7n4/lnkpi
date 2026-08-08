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
