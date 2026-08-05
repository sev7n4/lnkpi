from app.tools.prompt_mode_taxonomy import resolve_prompt_mode


def test_commercial_storyboard():
    assert resolve_prompt_mode("帮我生成问界M9的15秒商业分镜提示词") == "commercial_storyboard"


def test_character_turnaround():
    assert resolve_prompt_mode("年轻女性模特三视图提示词") == "character_turnaround"


def test_vision_text():
    assert resolve_prompt_mode("写一份详情页视觉方案构图策划") == "vision_text"


def test_generic_fallback():
    assert resolve_prompt_mode("hello world product") == "generic"
