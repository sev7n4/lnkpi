"""Load image prompting guide taxonomy and resolve scene/edit intent from utterance."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.config import settings


def _taxonomy_candidates() -> list[Path]:
    skill = Path(settings.skills_dir) / "atomic-create"
    candidates = [
        skill / "assets" / "image-prompting-guide-taxonomy.yaml",
    ]
    here = Path(__file__).resolve()
    # Monorepo dev fallback (packages/agent shared taxonomy)
    if len(here.parents) >= 5:
        candidates.append(
            here.parents[4]
            / "packages"
            / "agent"
            / "src"
            / "prompt-modes"
            / "image-prompting-guide-taxonomy.yaml"
        )
    return candidates


def _resolve_taxonomy_path() -> Path | None:
    for path in _taxonomy_candidates():
        if path.is_file():
            return path
    return None


@lru_cache(maxsize=1)
def _load_taxonomy() -> dict[str, list[dict[str, Any]]]:
    path = _resolve_taxonomy_path()
    if path is None:
        return {"generation_scenes": [], "edit_intents": []}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    scenes = raw.get("generation_scenes") or []
    intents = raw.get("edit_intents") or []
    return {
        "generation_scenes": [s for s in scenes if isinstance(s, dict) and s.get("id")],
        "edit_intents": [i for i in intents if isinstance(i, dict) and i.get("id")],
    }


def _match_entry(utterance: str, entries: list[dict[str, Any]]) -> str | None:
    text = (utterance or "").strip()
    if not text:
        return None
    lower = text.lower()
    for entry in entries:
        patterns = entry.get("patterns") or []
        for pat in patterns:
            p = str(pat)
            if p.lower() in lower or p in text:
                return str(entry["id"])
    return None


def resolve_guide_scene(utterance: str) -> str | None:
    """Heuristic generation scene id from utterance; None if no match."""
    return _match_entry(utterance, _load_taxonomy()["generation_scenes"])


def resolve_guide_edit_intent(utterance: str) -> str | None:
    """Heuristic edit intent id from utterance; None if no match."""
    return _match_entry(utterance, _load_taxonomy()["edit_intents"])


def apply_guide_taxonomy_to_items(
    items: list[dict[str, Any]],
    utterance: str,
) -> list[dict[str, Any]]:
    """Stamp guide scene/edit intent onto items without clearing prompt_mode.

    When both match, prefer edit intent (换装/抠图/合成) over generation scene.
    """
    scene_id = resolve_guide_scene(utterance)
    intent_id = resolve_guide_edit_intent(utterance)
    if not scene_id and not intent_id:
        return items
    # Prefer edit intent when both match (换装 / 抠图 / 合成).
    if intent_id:
        scene_id = None
    out: list[dict[str, Any]] = []
    for item in items:
        patched = dict(item)
        target = str(patched.get("target_type") or "")
        if target in ("prompt", "text", "image"):
            if intent_id and not patched.get("guideEditIntentId") and not patched.get(
                "guide_edit_intent_id"
            ):
                patched["guideEditIntentId"] = intent_id
            if scene_id and not patched.get("guideSceneId") and not patched.get("guide_scene_id"):
                patched["guideSceneId"] = scene_id
        out.append(patched)
    return out
