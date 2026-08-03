"""P4-04: atomic utterance prompt extraction + few-shot loading."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from app.graph.few_shot import load_few_shots
from app.graph.atomic_intent import build_atomic_spec, confirm_gate_for_type

_STRIP_PREFIXES = (
    "帮我生成一个",
    "帮我生成",
    "帮我做一个",
    "帮我做一张",
    "生成一个",
    "生成一张",
    "做一个",
    "来一张",
    "来一段",
    "写一段",
    "配一段",
    "给这段文案配一段",
    "给这段文案配",
    "用提示词模式扩写：",
    "用提示词模式扩写:",
)


def atomic_skill_path(skills_dir: Path | str | None = None) -> Path:
    from app.config import settings

    root = Path(skills_dir) if skills_dir is not None else Path(settings.skills_dir)
    return root / "atomic-create"


def load_atomic_parse_few_shots(skills_dir: Path | str | None = None) -> list[tuple[str, str]]:
    skill = atomic_skill_path(skills_dir)
    return load_few_shots(skill).get("parse_atomic_intent", [])


def extract_atomic_prompt(utterance: str) -> str:
    """Strip leading atomic hint prefixes; keep semantic payload for node prompt."""
    t = (utterance or "").strip()
    if not t:
        return ""
    for prefix in sorted(_STRIP_PREFIXES, key=len, reverse=True):
        if t.startswith(prefix):
            t = t[len(prefix) :].strip()
            break
    t = re.sub(r'^["「『](.+?)["」』]', r"\1", t).strip()
    return t or utterance.strip()


def build_atomic_spec_enriched(utterance: str) -> dict[str, Any]:
    """Keyword routing + cleaner prompt/title (P4-04)."""
    base = build_atomic_spec(utterance)
    prompt = extract_atomic_prompt(utterance)
    if prompt:
        base["prompt"] = prompt
        if len(prompt) <= 28:
            base["title"] = prompt
    return base


def parse_few_shot_json(assistant: str) -> dict[str, Any] | None:
    """Parse assistant JSON from few-shot example (test / future LLM validation)."""
    text = (assistant or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    target = str(data.get("target_type") or "").strip()
    if not target:
        return None
    confirm = data.get("confirm_gate")
    if confirm is None:
        confirm = confirm_gate_for_type(target)  # type: ignore[arg-type]
    return {
        "target_type": target,
        "prompt": str(data.get("prompt") or "").strip(),
        "title": str(data.get("title") or data.get("prompt") or target).strip(),
        "confirm_gate": bool(confirm),
    }


def load_parse_few_shots_doc(skills_dir: Path | str | None = None) -> dict[str, Any]:
    from app.config import settings

    root = Path(skills_dir) if skills_dir is not None else Path(settings.skills_dir)
    path = root / "atomic-create" / "assets" / "few-shots.yaml"
    if not path.is_file():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
