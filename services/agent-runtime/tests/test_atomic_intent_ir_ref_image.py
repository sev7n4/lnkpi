from app.graph.atomic_intent_ir import (
    derive_studio_prompt,
    has_generate_verb,
    has_image_output,
    is_ref_media_generation,
    resolve_atomic_intent,
)

STYLE3 = "@T1 请按风格3出图"


def test_has_generate_verb_chutu():
    assert has_generate_verb("按风格3出图")
    assert has_generate_verb("请出图")


def test_has_image_output_style_n():
    assert has_image_output("按风格3出图")


def test_ref_media_generation_t1_chutu():
    assert is_ref_media_generation(STYLE3, ["T1"])


def test_resolve_atomic_intent_style3():
    ir = resolve_atomic_intent(STYLE3, mentioned_keys=["T1"])
    assert ir.action == "generate"
    assert ir.output_modality == "image"
    assert ir.mentioned_keys == ("T1",)


def test_derive_studio_prompt_keeps_style3_utterance():
    ir = resolve_atomic_intent(STYLE3, mentioned_keys=["T1"])
    assert derive_studio_prompt(ir) == STYLE3
