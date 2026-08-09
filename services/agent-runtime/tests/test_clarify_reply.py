from app.graph.clarify_reply import classify_clarify_reply
from app.graph.intent_parse_schema import intent_result_to_parse_outcome


def test_clarify_reply_choice_1_inherits_original_style3():
    original = "@T1 请按风格3出图"
    result = classify_clarify_reply(original, "q", "1")
    assert result != "none"
    assert result["items"][0]["prompt"] == original


def test_clarify_reply_choice_1_generate_image():
    original = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    result = classify_clarify_reply(original, "q", "1")
    assert result != "none"
    assert result["route"] == "atomic_create"
    assert result["items"][0]["target_type"] == "image"
    outcome = intent_result_to_parse_outcome(result, "生成一张蓝牙耳机主图")
    assert outcome["kind"] == "success"


def test_clarify_reply_choice_2_campaign():
    original = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    result = classify_clarify_reply(original, "q", "2")
    assert result != "none"
    assert result["route"] == "campaign"
    outcome = intent_result_to_parse_outcome(result, original)
    assert outcome["kind"] == "clarify"
    assert outcome["reason"] == "llm_route_campaign"


def test_clarify_reply_choice_3_vision_text():
    original = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    result = classify_clarify_reply(original, "q", "3")
    assert result != "none"
    assert result["items"][0]["target_type"] == "text"
    assert result["items"][0].get("prompt_mode") == "vision_text"


def test_clarify_reply_natural_language():
    result = classify_clarify_reply("主图详情页方案", "q", "只要文字版构图策划，不出图")
    assert result != "none"
    assert result["action"] == "write"


def test_clarify_reply_unknown():
    assert classify_clarify_reply("x", "q", "随便说说") == "none"
