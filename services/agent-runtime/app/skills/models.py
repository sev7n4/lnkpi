from dataclasses import dataclass
from pathlib import Path


@dataclass
class SkillIndexEntry:
    skill_id: str
    name: str
    description: str
    path: Path


@dataclass
class LoadedSkill:
    index: SkillIndexEntry
    body: str
    frontmatter: dict
    canvas_manifest: dict | None
    max_downstream: int
