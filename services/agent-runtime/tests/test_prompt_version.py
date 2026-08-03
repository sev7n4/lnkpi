"""W19: Prompt version loading, rollback, and metrics."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.prompt_version import (
    parse_version_overrides,
    record_prompt_usage,
    resolve_active_version,
    resolve_prompt_body,
)
from app.skills.loader import discover_skills, load_skill


def test_parse_version_overrides_json():
    raw = '{"enterprise-marketing-campaign": "1.0.0", "other": "2.0.0"}'
    assert parse_version_overrides(raw) == {
        "enterprise-marketing-campaign": "1.0.0",
        "other": "2.0.0",
    }
    assert parse_version_overrides("{bad json") == {}


def test_resolve_active_version_override_wins():
    ver = resolve_active_version(
        "enterprise-marketing-campaign",
        declared_version="1.1.0",
        overrides={"enterprise-marketing-campaign": "1.0.0"},
    )
    assert ver == "1.0.0"


def test_load_skill_default_prompt_version(tmp_path: Path):
    skill_dir = tmp_path / "valid-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: valid-skill\n"
        "description: A valid skill for tests.\n"
        "metadata:\n"
        "  lnkpi.prompt_version: \"2.0.0\"\n"
        "---\n"
        "# Current body\n"
    )
    loaded = load_skill(discover_skills(tmp_path)[0])
    assert loaded.prompt_version == "2.0.0"
    assert loaded.body == "# Current body"


def test_load_skill_version_rollback_from_assets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    skill_dir = tmp_path / "valid-skill"
    prompts = skill_dir / "assets" / "prompts"
    prompts.mkdir(parents=True)
    (prompts / "1.0.0.md").write_text("# Rolled back body\n")
    (skill_dir / "SKILL.md").write_text(
        "---\n"
        "name: valid-skill\n"
        "description: A valid skill for tests.\n"
        "metadata:\n"
        "  lnkpi.prompt_version: \"1.1.0\"\n"
        "---\n"
        "# Current body\n"
    )
    monkeypatch.setenv(
        "LNKPI_PROMPT_VERSION_OVERRIDES",
        '{"valid-skill": "1.0.0"}',
    )
    from app.config import Settings

    monkeypatch.setattr(
        "app.prompt_version.settings",
        Settings(prompt_version_overrides='{"valid-skill": "1.0.0"}'),
    )

    loaded = load_skill(discover_skills(tmp_path)[0])
    assert loaded.prompt_version == "1.0.0"
    assert loaded.body == "# Rolled back body"


def test_resolve_prompt_body_fallback_to_default(tmp_path: Path):
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    body, ver = resolve_prompt_body(skill_dir, default_body="# default", active_version="9.9.9")
    assert ver == "9.9.9"
    assert body == "# default"


def test_record_prompt_usage_increments_metrics():
    from prometheus_client import REGISTRY

    before = REGISTRY.get_sample_value(
        "agent_prompt_invocations_total",
        {
            "skill_id": "enterprise-marketing-campaign",
            "prompt_version": "1.1.0",
            "node_name": "generate_plan",
        },
    )
    record_prompt_usage(
        skill_id="enterprise-marketing-campaign",
        prompt_version="1.1.0",
        node_name="generate_plan",
    )
    after = REGISTRY.get_sample_value(
        "agent_prompt_invocations_total",
        {
            "skill_id": "enterprise-marketing-campaign",
            "prompt_version": "1.1.0",
            "node_name": "generate_plan",
        },
    )
    assert float(after or 0) >= float(before or 0) + 1
