from app.graph.atomic_intent import (
    utterance_suggests_media_create,
    regen_intent,
)


def test_atomic_regenerate_positive():
    assert regen_intent("再试一次")
    assert regen_intent("重试")
    assert regen_intent("重新生成")
    assert regen_intent("重新生成一张")
    assert regen_intent("再来一次")
    assert regen_intent("重复上一次操作")
    assert regen_intent("重复上次")


def test_regenerate_phrase_not_atomic_create():
    assert not utterance_suggests_media_create("重新生成一张")
    assert regen_intent("重新生成一张")


def test_atomic_regenerate_not_new_create():
    assert not regen_intent("帮我生成一个模特人物图")
    assert utterance_suggests_media_create("帮我生成一个模特人物图")


def test_atomic_regenerate_not_campaign():
    assert not regen_intent("帮我做一套天猫蓝牙耳机详情页营销方案")


def test_atomic_regenerate_not_confirm_gate_reply():
    assert not regen_intent("确认生成")
    assert not regen_intent("取消")
