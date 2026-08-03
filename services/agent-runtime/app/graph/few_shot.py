"""W20: Few-shot example loading and unified LLM message assembly."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

_FEW_SHOT_REL = "assets/few-shots.yaml"


def _skills_root(skills_dir: Path | str | None) -> Path:
    if skills_dir is not None:
        return Path(skills_dir)
    from app.config import settings

    return Path(settings.skills_dir)


def load_few_shots(skill_path: Path) -> dict[str, list[tuple[str, str]]]:
    """Load node -> [(user, assistant), ...] from skill assets/few-shots.yaml."""
    path = skill_path / _FEW_SHOT_REL
    if not path.is_file():
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load few-shots from %s: %s", path, exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    nodes = raw.get("nodes") or raw
    if not isinstance(nodes, dict):
        return {}
    out: dict[str, list[tuple[str, str]]] = {}
    for node_name, pairs in nodes.items():
        if not isinstance(pairs, list):
            continue
        examples: list[tuple[str, str]] = []
        for item in pairs:
            if not isinstance(item, dict):
                continue
            user = str(item.get("user") or "").strip()
            assistant = str(item.get("assistant") or "").strip()
            if user and assistant:
                examples.append((user, assistant))
        if examples:
            out[str(node_name)] = examples
    return out


def few_shots_for_skill(
    skill_id: str | None,
    node_name: str,
    *,
    skills_dir: Path | str | None = None,
) -> list[tuple[str, str]]:
    if not skill_id:
        return []
    root = _skills_root(skills_dir)
    skill_path = root / str(skill_id)
    if not skill_path.is_dir():
        return []
    return load_few_shots(skill_path).get(node_name, [])


def build_llm_messages(
    *,
    system: str,
    user: str,
    few_shots: list[tuple[str, str]] | None = None,
) -> list[BaseMessage]:
    """Assemble system + optional few-shot pairs + final user turn."""
    messages: list[BaseMessage] = [SystemMessage(content=system)]
    for example_user, example_assistant in few_shots or []:
        messages.append(HumanMessage(content=example_user))
        messages.append(AIMessage(content=example_assistant))
    messages.append(HumanMessage(content=user))
    return messages
