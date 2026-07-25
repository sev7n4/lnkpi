from pathlib import Path

from app.skills.loader import discover_skills, load_skill

SKILLS = Path(__file__).resolve().parents[1] / "skills"


def _items():
    entries = {e.skill_id: e for e in discover_skills(SKILLS)}
    skill = load_skill(entries["enterprise-marketing-campaign"])
    return skill.canvas_manifest["items"]


def test_no_legacy_model_or_show_video():
    keys = {i["key"] for i in _items()}
    assert "model" not in keys
    assert "show_video" not in keys
    assert {"video_product", "video_scene", "video_lifestyle"} <= keys
    assert {"model_portrait", "model_turnaround", "model_lifestyle"} <= keys
    assert "product_turnaround" in keys


def test_copy_not_in_video_deps():
    for it in _items():
        if str(it["key"]).startswith("video_"):
            assert "copy_main" not in (it.get("depends_on") or [])


def test_turnaround_prompts_mention_four_panels():
    by = {i["key"]: i for i in _items()}
    for k in ("product_turnaround", "model_turnaround"):
        hint = by[k]["prompt_hint_template"]
        assert "特写" in hint and "正" in hint and "侧" in hint and "背" in hint


def test_video_prompts_mention_voiceover_or_subtitle():
    for it in _items():
        if str(it["key"]).startswith("video_"):
            h = it["prompt_hint_template"]
            assert "旁白" in h or "字幕" in h


def test_max_downstream_covers_items():
    entries = {e.skill_id: e for e in discover_skills(SKILLS)}
    skill = load_skill(entries["enterprise-marketing-campaign"])
    assert skill.max_downstream >= len(skill.canvas_manifest["items"])
