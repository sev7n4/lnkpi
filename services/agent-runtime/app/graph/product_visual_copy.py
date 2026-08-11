"""User-facing copy for product_visual v2 — loaded from Skill YAML assets."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_SERVICE_FAILURE_REASONS = frozenset(
    {"format_error", "timeout", "service_unavailable", "vision_format_error"}
)


class ProductVisualCopy:
    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    @classmethod
    def load_from_skill(
        cls,
        skill_id: str,
        version: str,
        *,
        skills_dir: Path | str | None = None,
    ) -> ProductVisualCopy:
        root = cls._resolve_skills_dir(skills_dir)
        path = root / skill_id / "assets" / "copy" / f"{version}.yaml"
        if not path.is_file():
            raise FileNotFoundError(f"Product visual copy not found: {path}")
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise ValueError(f"Invalid copy YAML at {path}")
        return cls(raw)

    @staticmethod
    def _resolve_skills_dir(skills_dir: Path | str | None) -> Path:
        if skills_dir is not None:
            raw = Path(skills_dir)
            return raw if raw.is_absolute() else Path(__file__).resolve().parents[2] / raw
        from app.runs import resolve_skills_dir

        return resolve_skills_dir()

    def get(self, key: str, **slots: str) -> str:
        """Resolve dot-separated key (e.g. ``qa.service_unavailable_title``)."""
        node: Any = self._data
        for part in key.split("."):
            if not isinstance(node, dict):
                return key
            node = node.get(part)
        if not isinstance(node, str):
            return key
        if not slots:
            return node
        try:
            return node.format(**slots)
        except KeyError:
            return node

    def map_qa_failure(
        self,
        *,
        reason: str,
        vision_used: bool,
        metrics: dict,
    ) -> dict[str, str]:
        """Map internal QA failure to user-facing title/body — stub for P0-1."""
        _ = (vision_used, metrics)
        if reason in _SERVICE_FAILURE_REASONS:
            return {
                "title": self.get("qa.service_unavailable_title"),
                "body": self.get("qa.service_unavailable_body"),
            }
        return {
            "title": self.get("qa.quality_fail_title"),
            "body": self.get("qa.service_unavailable_body"),
        }
