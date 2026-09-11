from app.tools.guide_taxonomy import (
    apply_guide_taxonomy_to_items,
    resolve_guide_edit_intent,
    resolve_guide_scene,
)


def test_g3_exact_text():
    assert resolve_guide_scene("广告图，标语必须精确文字 Yours to Create，不要多余字") == "g3_exact_text"


def test_e5_cutout():
    assert resolve_guide_edit_intent("把产品抠图做成透明底 PNG") == "e5_transparent_cutout"


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
