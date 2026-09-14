from app.graph.product_visual_v2.vision_qa_client import supports_vision_model


def test_flash_aliases_are_vision():
    assert supports_vision_model("deepseek-flash") is True
    assert supports_vision_model("ch_x::deepseek-flash") is True
    assert supports_vision_model("deepseek-v4-flash") is True
    assert supports_vision_model("deepseek-v4.1-flash") is True
    assert supports_vision_model("deepseek-v4-flash-vision-exp") is True


def test_deepseek_pro_is_not_vision():
    assert supports_vision_model("deepseek-v4-pro") is False
    assert supports_vision_model("ch_x::deepseek-v3.2") is False


def test_gemini_still_vision():
    assert supports_vision_model("gemini-3.5-flash-lite") is True
