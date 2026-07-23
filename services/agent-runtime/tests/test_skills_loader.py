from pathlib import Path

from app.skills.loader import discover_skills, load_skill

FIXTURES = Path(__file__).parent / "fixtures"


def test_discover_skips_underscore_and_requires_skill_md(tmp_path: Path):
    (tmp_path / "_draft").mkdir()
    (tmp_path / "_draft" / "SKILL.md").write_text("---\nname: x\ndescription: d\n---\n# x\n")
    good = tmp_path / "valid-skill"
    good.mkdir()
    (good / "SKILL.md").write_text(
        "---\nname: valid-skill\ndescription: A valid skill for tests.\n---\n# Valid\n"
    )
    found = discover_skills(tmp_path)
    assert [e.skill_id for e in found] == ["valid-skill"]


def test_discover_skips_bad_yaml_beside_good_skill(tmp_path: Path):
    bad = tmp_path / "broken-skill"
    bad.mkdir()
    (bad / "SKILL.md").write_text("---\nname: [unterminated\ndescription: bad\n---\n# Broken\n")
    good = tmp_path / "valid-skill"
    good.mkdir()
    (good / "SKILL.md").write_text(
        "---\nname: valid-skill\ndescription: A valid skill for tests.\n---\n# Valid\n"
    )
    found = discover_skills(tmp_path)
    assert [e.skill_id for e in found] == ["valid-skill"]


def test_load_skill_reads_canvas_manifest(tmp_path: Path):
    skill_dir = tmp_path / "valid-skill"
    skill_dir.mkdir()
    assets = skill_dir / "assets"
    assets.mkdir()
    (assets / "canvas-manifest.yaml").write_text("schema_version: 1\n")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: valid-skill\ndescription: A valid skill for tests.\n---\n# Valid\n"
    )
    loaded = load_skill(discover_skills(tmp_path)[0])
    assert loaded.canvas_manifest is not None
    assert loaded.canvas_manifest["schema_version"] == 1


def test_reject_name_mismatch(tmp_path: Path):
    d = tmp_path / "foo"
    d.mkdir()
    (d / "SKILL.md").write_text("---\nname: bar\ndescription: desc here ok length\n---\n# x\n")
    entry = discover_skills(tmp_path)[0]
    try:
        load_skill(entry)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "name" in str(e).lower()
