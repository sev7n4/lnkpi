from pathlib import Path

from app.skills.loader import discover_skills, load_skill


def test_builtin_marketing_skill_loads():
    root = Path(__file__).resolve().parents[1] / "skills"
    entries = discover_skills(root)
    ids = {e.skill_id for e in entries}
    assert "enterprise-marketing-campaign" in ids
    loaded = load_skill(next(e for e in entries if e.skill_id == "enterprise-marketing-campaign"))
    keys = {i["key"] for i in loaded.canvas_manifest["items"]}
    assert "white_bg" in keys and "hero_main" in keys
    assert any(i["key"] == "show_video" and i["auto_generate"] is False for i in loaded.canvas_manifest["items"])
