from app.graph.nodes.chat import _SYSTEM

FORBIDDEN = (
    "没有生成",
    "无法生成图片",
    "不能生成图",
    "Midjourney",
    "midjourney",
    "Stable Diffusion",
)


def test_chat_system_does_not_deny_or_divert():
    for bad in FORBIDDEN:
        assert bad not in _SYSTEM, bad


def test_chat_system_mentions_honest_capability_or_redirect():
    # 至少提示可生成图或引导说清意图，而非只推营销
    assert ("生成" in _SYSTEM) or ("出图" in _SYSTEM) or ("画布" in _SYSTEM)
    assert "天猫详情页营销方案" not in _SYSTEM or "也可以" in _SYSTEM or "可选" in _SYSTEM


def test_chat_system_not_legacy_no_image_promise():
    assert "不要擅自创建画布方案或承诺自动出图" not in _SYSTEM


def test_chat_system_forbids_fake_in_progress_generation():
    assert "马上生成" in _SYSTEM or "正在生成" in _SYSTEM


def test_chat_system_forbids_filename_copout_when_parse_present():
    assert "若已提供【侧栏参考图解析】" in _SYSTEM
    assert "不得声称只能看到文件名或画布节点标题" in _SYSTEM


def test_chat_system_requires_arrange_along_edges_on_new_nodes():
    assert "arrange_nodes_along_edges" in _SYSTEM
    assert "connect_nodes" in _SYSTEM
    assert "整张画布" in _SYSTEM
    assert "已在服务端" in _SYSTEM or "默认顺连线" in _SYSTEM
    # import/instantiate must not still require a follow-up arrange as hard obligation
    assert "写完拓扑（connect_nodes / import_workflow / instantiate_workflow_template 成功）" not in _SYSTEM


def test_chat_system_routes_upscale_to_tool_not_run_star():
    assert "upscale_image" in _SYSTEM
    assert "upsert_media_node" in _SYSTEM
    assert "禁止" in _SYSTEM or "不要调用 run_*" in _SYSTEM


def test_chat_system_says_not_to_search_core_media_tools():
    assert "tool_search" in _SYSTEM
    assert "upsert_media_node" in _SYSTEM
    assert "propose_generation" in _SYSTEM
    assert "不要用 tool_search" in _SYSTEM or "勿用 tool_search" in _SYSTEM


def test_chat_system_sidebar_chips_are_not_canvas_ids():
    assert "@I1" in _SYSTEM or "侧栏芯片" in _SYSTEM
    assert "不是画布节点" in _SYSTEM or "不是画布" in _SYSTEM
    assert "apply_sidebar_attachments" in _SYSTEM


def test_chat_system_hang_identity_chips_vs_canvas_ids():
    assert "apply_sidebar_attachments" in _SYSTEM
    assert "attach_refs" in _SYSTEM
    assert "芯片" in _SYSTEM
    assert "image-*" in _SYSTEM or "画布节点" in _SYSTEM


def test_chat_system_idle_must_not_require_propose():
    assert "谢谢" in _SYSTEM or "闲聊" in _SYSTEM
    assert "propose_generation" in _SYSTEM


def test_chat_system_instantiate_only_after_confirm_canvas():
    assert "确认落到画布" in _SYSTEM
    assert "instantiate_workflow_template" in _SYSTEM


def test_chat_system_v1_skeleton_prefers_upsert_connect_propose():
    assert "connect_nodes" in _SYSTEM
    assert "upsert_media_node" in _SYSTEM
    assert "propose_generation" in _SYSTEM
    assert "生图" in _SYSTEM and "生视频" in _SYSTEM
    assert "dock" in _SYSTEM.lower() or "填" in _SYSTEM
    assert "不要压成单个" in _SYSTEM or "不要压成" in _SYSTEM


def test_chat_system_v1_skeleton_must_not_prefer_import():
    assert "import_workflow" in _SYSTEM
    assert "口语搭骨架" in _SYSTEM or "骨架" in _SYSTEM


def test_explore_write_retry_names_operator_skeleton_tools():
    from app.graph.nodes.explore import make_explore_node
    import inspect

    src = inspect.getsource(make_explore_node)
    assert "upsert_media_node" in src
    assert "connect_nodes" in src
    assert "propose_generation" in src
