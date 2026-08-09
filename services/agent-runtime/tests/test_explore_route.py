"""Tests for explore routing signals."""

from app.graph.explore_route import explore_canvas_signal, explore_explicit_intent


def test_explicit_node_id_update_routes_explore():
    u = "查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-测试文案"
    assert explore_explicit_intent(u) is True


def test_asset_library_query():
    u = "查询我的资产库有哪些素材，列出名称和类型"
    assert explore_explicit_intent(u) is True


def test_atomic_gen_still_blocked():
    u = "帮我在画布上生成一张产品主图"
    assert explore_explicit_intent(u) is False
    assert explore_canvas_signal(u, blocked_by_atomic=True) is False


def test_upsert_without_gen():
    u = "查询画布空白区域，添加一个 prompt 节点 explore-upsert-demo（不要触发出图）"
    assert explore_explicit_intent(u) is True


def test_cancel_generation_lifecycle():
    u = "取消 image-16 节点上正在进行的生成任务"
    assert explore_explicit_intent(u) is True


def test_upload_media_explore_only():
    u = "查询画布，把图片 URL 上传到画布加一个 image 节点（仅上传，不要出图）"
    assert explore_explicit_intent(u) is True
