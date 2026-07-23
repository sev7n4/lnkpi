from __future__ import annotations

import logging
import re
from pathlib import Path

import yaml

from app.skills.models import LoadedSkill, SkillIndexEntry

logger = logging.getLogger(__name__)

_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_DEFAULT_CANVAS_MANIFEST = "assets/canvas-manifest.yaml"
_DEFAULT_MAX_DOWNSTREAM = "12"


def discover_skills(root: Path) -> list[SkillIndexEntry]:
    if not root.is_dir():
        return []

    entries: list[SkillIndexEntry] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        try:
            frontmatter, _ = _parse_skill_md(skill_md.read_text(encoding="utf-8"))
            name = frontmatter.get("name", "")
            description = frontmatter.get("description", "")
            entries.append(
                SkillIndexEntry(
                    skill_id=child.name,
                    name=str(name),
                    description=str(description),
                    path=child,
                )
            )
        except Exception as exc:  # noqa: BLE001 — skip bad skills, keep discovery going
            logger.warning("Skipping skill %s: %s", child.name, exc)
            continue
    return entries


def load_skill(entry: SkillIndexEntry) -> LoadedSkill:
    skill_md = entry.path / "SKILL.md"
    frontmatter, body = _parse_skill_md(skill_md.read_text(encoding="utf-8"))

    name = frontmatter.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("name is required in frontmatter")

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description:
        raise ValueError("description is required in frontmatter")

    _validate_name(name, entry.path.name)
    _validate_description(description)

    metadata = frontmatter.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    manifest_rel = metadata.get("lnkpi.canvas_manifest", _DEFAULT_CANVAS_MANIFEST)
    canvas_manifest = None
    if isinstance(manifest_rel, str):
        manifest_path = entry.path / manifest_rel
        if manifest_path.is_file():
            canvas_manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))

    max_downstream_raw = metadata.get("lnkpi.max_downstream", _DEFAULT_MAX_DOWNSTREAM)
    max_downstream = int(max_downstream_raw)

    return LoadedSkill(
        index=entry,
        body=body,
        frontmatter=frontmatter,
        canvas_manifest=canvas_manifest,
        max_downstream=max_downstream,
    )


def _parse_skill_md(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        raise ValueError("SKILL.md must begin with YAML frontmatter")

    parts = content.split("---", 2)
    if len(parts) < 3:
        raise ValueError("invalid frontmatter in SKILL.md")

    frontmatter = yaml.safe_load(parts[1]) or {}
    if not isinstance(frontmatter, dict):
        raise ValueError("frontmatter must be a mapping")

    body = parts[2].lstrip("\n")
    return frontmatter, body


def _validate_name(name: str, dir_name: str) -> None:
    if len(name) > 64:
        raise ValueError("name must be at most 64 characters")
    if not _NAME_PATTERN.match(name):
        raise ValueError("name must use lowercase letters, digits, and hyphens only")
    if name != dir_name:
        raise ValueError("name must match the skill directory name")


def _validate_description(description: str) -> None:
    if len(description) > 1024:
        raise ValueError("description must be at most 1024 characters")
