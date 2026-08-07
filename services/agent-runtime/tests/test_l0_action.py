from app.graph.l0_action import (
    detect_l0_action,
    has_preserve_intent,
    utterance_has_multi_image_refs,
)

PROD_CASE = (
    "@I1 这个是模特图，@I2 这个是产品图，让模特穿上这件衣服。"
    "保持主图风格，背景，构图不变。"
)


def test_preserve_prod_case():
    assert has_preserve_intent(PROD_CASE)


def test_preserve_blocks_planning_read():
    assert detect_l0_action(PROD_CASE) == "preserve"


def test_plan_without_preserve():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert detect_l0_action(u) == "plan"
    assert not has_preserve_intent(u)


def test_multi_image_refs_from_utterance():
    assert utterance_has_multi_image_refs(PROD_CASE)


def test_single_image_ref_not_multi():
    assert not utterance_has_multi_image_refs("按 @I1 风格生成主图")
