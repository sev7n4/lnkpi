from app.graph.planning_guard import (
    detect_action,
    has_planning_image_conflict,
    is_explicit_generation_intent,
    is_planning_intent,
    planning_clarify_question,
    planning_guard_confidence_cap,
)


def test_design_detail_page_planning_conflict():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert is_planning_intent(u)
    assert has_planning_image_conflict(u)
    assert not is_explicit_generation_intent(u)
    assert detect_action(u) == "plan"


def test_generate_single_hero_not_planning_conflict():
    u = "生成一张蓝牙耳机主图"
    assert is_explicit_generation_intent(u)
    assert not has_planning_image_conflict(u)
    assert detect_action(u) == "generate"


def test_design_one_poster_is_generation_not_planning():
    u = "设计一张赛博朋克海报"
    assert is_explicit_generation_intent(u)
    assert detect_action(u) == "generate"


def test_confidence_cap_on_conflict():
    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    assert planning_guard_confidence_cap(u, 0.96) <= 0.65


def test_confidence_unchanged_for_explicit_generate():
    u = "生成一张蓝牙耳机主图"
    assert planning_guard_confidence_cap(u, 0.96) == 0.96


def test_clarify_question_nonempty():
    q = planning_clarify_question("主图详情页构图方案")
    assert "1" in q and "2" in q
    assert "Campaign" in q or "方案" in q


def test_detail_page_write_only_not_conflict():
    u = "写一份详情页模块构图策划文档，不出图"
    assert is_planning_intent(u)
    assert not has_planning_image_conflict(u)


def test_validate_llm_parse_blocks_generate_on_planning_conflict():
    from app.graph.planning_guard import validate_llm_parse

    u = "请你帮我设计一个蓝牙耳机主图，详情页的构图方案"
    result = {
        "action": "generate",
        "route": "atomic_create",
        "items": [{"target_type": "image", "prompt": u, "title": "主图"}],
        "confidence": 0.95,
    }
    out = validate_llm_parse(result, u)  # type: ignore[arg-type]
    assert out is not None
    assert out["kind"] == "clarify"
    assert out["reason"] == "planning_image_conflict"


def test_validate_llm_parse_blocks_plan_with_image_items():
    from app.graph.planning_guard import validate_llm_parse

    u = "详情页构图方案"
    result = {
        "action": "plan",
        "route": "atomic_create",
        "items": [{"target_type": "image", "prompt": u, "title": "x"}],
        "confidence": 0.9,
    }
    out = validate_llm_parse(result, u)  # type: ignore[arg-type]
    assert out is not None
    assert out["kind"] == "clarify"


def test_validate_llm_parse_ok_for_explicit_generate():
    from app.graph.planning_guard import validate_llm_parse

    u = "生成一张蓝牙耳机主图"
    result = {
        "action": "generate",
        "route": "atomic_create",
        "items": [{"target_type": "image", "prompt": u, "title": "主图"}],
        "confidence": 0.94,
    }
    assert validate_llm_parse(result, u) is None  # type: ignore[arg-type]
