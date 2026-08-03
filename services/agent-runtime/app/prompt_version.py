"""W19: Prompt template versioning — load, rollback, and observability."""

from __future__ import annotations

import json
import logging
from typing import Any

from opentelemetry import trace

from app.config import settings
from app.metrics import record_prompt_invocation

logger = logging.getLogger(__name__)

_DEFAULT_VERSION = "1.0.0"
_PROMPTS_DIR = "assets/prompts"


def parse_version_overrides(raw: str | None = None) -> dict[str, str]:
    """Parse LNKPI_PROMPT_VERSION_OVERRIDES JSON map (skill_id -> version)."""
    text = raw if raw is not None else settings.prompt_version_overrides
    if not text or not str(text).strip():
        return {}
    try:
        parsed = json.loads(str(text))
    except json.JSONDecodeError:
        logger.warning("Invalid prompt_version_overrides JSON; ignoring")
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items() if k and v}


def resolve_active_version(
    skill_id: str,
    *,
    declared_version: str,
    overrides: dict[str, str] | None = None,
) -> str:
    """Pick runtime version: per-skill override wins, else declared frontmatter version."""
    pin = (overrides or parse_version_overrides()).get(skill_id)
    return pin or declared_version or _DEFAULT_VERSION


def resolve_prompt_body(
    skill_path: Any,
    *,
    default_body: str,
    active_version: str,
) -> tuple[str, str]:
    """Load versioned prompt body; fall back to SKILL.md body when file missing."""
    version_file = skill_path / _PROMPTS_DIR / f"{active_version}.md"
    if version_file.is_file():
        return version_file.read_text(encoding="utf-8").strip(), active_version
    return default_body.strip(), active_version


def record_prompt_usage(
    *,
    skill_id: str,
    prompt_version: str,
    node_name: str,
) -> None:
    """Log + metrics (+ trace attribute when span is active)."""
    sid = skill_id or "unknown"
    ver = prompt_version or _DEFAULT_VERSION
    node = node_name or "unknown"
    logger.info(
        "prompt_invocation skill_id=%s prompt_version=%s node=%s",
        sid,
        ver,
        node,
    )
    record_prompt_invocation(sid, ver, node)
    span = trace.get_current_span()
    if span and span.is_recording():
        span.set_attribute("prompt.skill_id", sid)
        span.set_attribute("prompt.version", ver)
        span.set_attribute("prompt.node", node)
