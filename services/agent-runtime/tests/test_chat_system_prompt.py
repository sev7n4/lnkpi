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
    assert "闲聊" in _SYSTEM or "未进入创作" in _SYSTEM or "尚未进入创作" in _SYSTEM
