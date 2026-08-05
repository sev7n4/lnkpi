"""Load shared prompt_mode taxonomy and resolve mode from utterance."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.graph.atomic_parse_util import atomic_skill_path


def _taxonomy_candidates() -> list[Path]:
    skill = atomic_skill_path()
    candidates = [
        skill / "assets" / "prompt-mode-taxonomy.yaml",
    ]
    here = Path(__file__).resolve()
    # Monorepo dev fallback (packages/agent shared taxonomy)
    if len(here.parents) >= 5:
        candidates.append(
            here.parents[4] / "packages" / "agent" / "src" / "prompt-modes" / "taxonomy.yaml"
        )
    return candidates


def _resolve_taxonomy_path() -> Path | None:
    for path in _taxonomy_candidates():
        if path.is_file():
            return path
    return None


@lru_cache(maxsize=1)
def _load_taxonomy() -> list[dict[str, Any]]:
    path = _resolve_taxonomy_path()
    if path is None:
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    modes = raw.get("modes") or []
    return [m for m in modes if isinstance(m, dict) and m.get("id")]


def resolve_prompt_mode(utterance: str) -> str | None:
    """Heuristic prompt_mode from utterance; mirrors packages/agent classify.ts."""
    text = (utterance or "").strip()
    if not text:
        return None
    lower = text.lower()

    ordered_ids = (
        "character_turnaround",
        "commercial_storyboard",
        "storyboard",
        "script",
        "copywriting",
        "image_prompt_multi_style",
        "vision_text",
    )
    by_id = {str(m["id"]): m for m in _load_taxonomy()}
    for mode_id in ordered_ids:
        mode = by_id.get(mode_id)
        if not mode:
            continue
        patterns = mode.get("patterns") or []
        for pat in patterns:
            p = str(pat)
            if p.lower() in lower or p in text:
                if mode_id == "storyboard" and re.search(
                    r"商业分镜|品牌分镜|问界|AITO", text, re.I
                ):
                    continue
                return mode_id
    return "generic"
