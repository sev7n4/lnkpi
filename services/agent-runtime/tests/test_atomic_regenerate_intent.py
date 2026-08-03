from app.graph.atomic_intent import (
    atomic_create_intent,
    atomic_regenerate_intent,
)


def test_atomic_regenerate_positive():
    assert atomic_regenerate_intent("再试一次")
    assert atomic_regenerate_intent("重试")
    assert atomic_regenerate_intent("重新生成")
    assert atomic_regenerate_intent("再来一次")


def test_atomic_regenerate_not_new_create():
    assert not atomic_regenerate_intent("帮我生成一个模特人物图")
    assert atomic_create_intent("帮我生成一个模特人物图")


def test_atomic_regenerate_not_campaign():
    assert not atomic_regenerate_intent("帮我做一套天猫蓝牙耳机详情页营销方案")


def test_atomic_regenerate_not_confirm_gate_reply():
    assert not atomic_regenerate_intent("确认生成")
    assert not atomic_regenerate_intent("取消")
