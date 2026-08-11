"""User-facing copy for product_visual v2 — loaded from Skill YAML assets."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_SERVICE_FAILURE_REASONS = frozenset(
    {"format_error", "timeout", "service_unavailable", "vision_format_error"}
)

_SERVICE_UNAVAILABLE_KEYWORDS = (
    "格式异常",
    "timeout",
    "超时",
    "未调用",
    "未配置",
    "不支持识图",
    "缺少产品",
    "识图模型",
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

    def _qa_options(self) -> list[dict[str, str]]:
        confirm = self.get("qa.confirm_use_image")
        return [
            {"id": "confirm_pass", "label": confirm, "message": confirm},
            {
                "id": "retake",
                "label": self.get("qa.retake_label"),
                "message": self.get("qa.retake_message"),
            },
            {
                "id": "ai_white_bg",
                "label": self.get("qa.ai_white_bg_label"),
                "message": self.get("qa.ai_white_bg_message"),
            },
        ]

    @staticmethod
    def _is_service_unavailable(*, reason: str, vision_used: bool) -> bool:
        if reason in _SERVICE_FAILURE_REASONS:
            return True
        if any(k in reason for k in _SERVICE_UNAVAILABLE_KEYWORDS):
            return True
        if not vision_used and any(
            k in reason for k in ("未调用", "未配置", "不支持识图", "缺少产品", "未选择")
        ):
            return True
        return False

    @staticmethod
    def _has_explicit_quality_fail(metrics: dict) -> bool:
        if metrics.get("is_sharp_enough") is False:
            return True
        if metrics.get("is_white_bg") is False and metrics.get("scene_kind") != "interior":
            return True
        if metrics.get("product_identifiable") is False:
            return True
        if metrics.get("sharpness", 1.0) < 0.5:
            return True
        return False

    def map_qa_failure(
        self,
        *,
        reason: str,
        vision_used: bool,
        metrics: dict,
    ) -> dict[str, Any]:
        """Map internal QA failure to user-facing presentation fields."""
        metrics = metrics or {}
        options = self._qa_options()

        if self._is_service_unavailable(reason=reason, vision_used=vision_used):
            return {
                "kind": "callout_info",
                "title": self.get("qa.service_unavailable_title"),
                "body": self.get("qa.service_unavailable_body"),
                "options": options,
            }

        if vision_used and self._has_explicit_quality_fail(metrics):
            return {
                "kind": "callout_warn",
                "title": self.get("qa.quality_fail_title"),
                "body": self.get("qa.quality_fail_body"),
                "options": options,
            }

        if not vision_used and self._has_explicit_quality_fail(metrics):
            return {
                "kind": "callout_warn",
                "title": self.get("qa.quality_fail_title"),
                "body": self.get("qa.quality_fail_body"),
                "options": options,
            }

        # soft_pass: sharpness ok, no explicit fail — heuristic / inconclusive
        return {
            "kind": "callout_info",
            "title": self.get("qa.service_unavailable_title"),
            "body": self.get("qa.soft_pass_body"),
            "options": options,
        }
