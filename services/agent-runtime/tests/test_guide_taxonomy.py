import pytest

from app.tools.guide_taxonomy import (
    apply_guide_taxonomy_to_items,
    resolve_guide_edit_intent,
    resolve_guide_scene,
)


def test_g3_exact_text():
    assert resolve_guide_scene("广告图，标语必须精确文字 Yours to Create，不要多余字") == "g3_exact_text"


def test_e5_cutout():
    assert resolve_guide_edit_intent("把产品抠图做成透明底 PNG") == "e5_transparent_cutout"


@pytest.mark.parametrize(
    ("utterance", "expected"),
    [
        ("把步骤整理成流程信息图", "g2_process_infographic"),
        ("设计一个 logo 透明底版本", "g4_reusable_logo"),
        ("重现有时代细节的历史语境", "g5_historical_context"),
        ("用漫画分格讲一个故事", "g6_comic_strip"),
        ("制作移动应用的界面预览", "g7_interface_preview"),
        ("绘制清晰的科学教育图", "g8_scientific_visual"),
        ("根据这些数据制作幻灯片图表", "g9_slides_charts"),
    ],
)
def test_resolve_new_generation_scenes(utterance, expected):
    assert resolve_guide_scene(utterance) == expected


@pytest.mark.parametrize(
    ("utterance", "expected"),
    [
        ("保持设计不变，只做版面翻译", "e1_translate_layout"),
        ("参考第二张图进行风格迁移", "e2_style_transfer"),
        ("把这张草图转写实", "e6_drawing_to_realistic"),
        ("去物体并自然补全背景", "e7_remove_object"),
        ("去掉物体并保留其他内容", "e7_remove_object"),
        ("把参考人物入景到街道照片", "e8_insert_person"),
    ],
)
def test_resolve_new_edit_intents(utterance, expected):
    assert resolve_guide_edit_intent(utterance) == expected


def test_no_false_positive_on_hello():
    assert resolve_guide_scene("你好") is None
    assert resolve_guide_edit_intent("你好") is None


def test_prefer_edit_intent_when_both_match():
    items = apply_guide_taxonomy_to_items(
        [{"target_type": "image", "prompt": "精确文字换装保留脸"}],
        "精确文字换装保留脸",
    )
    assert items[0].get("guideEditIntentId") == "e3_identity_clothing"
    assert items[0].get("guideSceneId") is None
