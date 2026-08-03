"""P4-04/05: atomic utterance parse — prompt extraction, canvas context, few-shots."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from app.graph.few_shot import load_few_shots
from app.graph.atomic_intent import build_atomic_spec, confirm_gate_for_type

_DEICTIC_HINTS = ("这个", "这张", "该", "主图", "当前", "刚才")

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


def canvas_summary_nodes(canvas_summary: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = (canvas_summary or {}).get("nodes") or []
    return [n for n in raw if isinstance(n, dict)]


def format_canvas_context_line(nodes: list[dict[str, Any]]) -> str:
    """Compact canvas stats for parse context (P4-05)."""
    if not nodes:
        return "画布为空"
    by_type: dict[str, int] = {}
    for node in nodes:
        kind = str(node.get("type") or "unknown")
        by_type[kind] = by_type.get(kind, 0) + 1
    counts = ", ".join(f"{k}×{v}" for k, v in sorted(by_type.items()))
    titles = [str(n.get("title") or "").strip() for n in nodes if n.get("title")]
    titles = [t for t in titles if t][:8]
    title_bit = f"；已有：{'、'.join(titles)}" if titles else ""
    return f"画布 {len(nodes)} 节点（{counts}）{title_bit}"


def _existing_titles(nodes: list[dict[str, Any]]) -> set[str]:
    return {str(n.get("title") or "").strip() for n in nodes if str(n.get("title") or "").strip()}


def dedupe_atomic_title(title: str, nodes: list[dict[str, Any]]) -> str:
    """Avoid creating another node with the same title when canvas already has one."""
    base = (title or "").strip()
    if not base:
        return title
    existing = _existing_titles(nodes)
    if base not in existing:
        return base
    for i in range(2, 20):
        candidate = f"{base} ({i})"
        if candidate not in existing:
            return candidate
    return f"{base} ({len(nodes) + 1})"


def resolve_focus_seed(utterance: str, focus_node_id: str | None, nodes: list[dict[str, Any]]) -> str | None:
    """Seed prompt/title from focused canvas node when user uses deictic reference."""
    if not focus_node_id or not nodes:
        return None
    if not any(h in (utterance or "") for h in _DEICTIC_HINTS):
        return None
    for node in nodes:
        if str(node.get("id") or "") != focus_node_id:
            continue
        title = str(node.get("title") or "").strip()
        return title or None
    return None


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


def build_atomic_spec_enriched(
    utterance: str,
    *,
    canvas_summary: dict[str, Any] | None = None,
    focus_node_id: str | None = None,
) -> dict[str, Any]:
    """Keyword routing + prompt/title cleanup + canvas context (P4-04/05)."""
    nodes = canvas_summary_nodes(canvas_summary)
    base = build_atomic_spec(utterance)
    prompt = extract_atomic_prompt(utterance)
    focus_seed = resolve_focus_seed(utterance, focus_node_id, nodes)
    if focus_seed:
        if "扩写" in utterance or base.get("target_type") == "prompt":
            if not prompt or prompt in ("这个主图 prompt", "主图 prompt", "这个主图"):
                prompt = focus_seed
            elif focus_seed not in prompt:
                prompt = f"{focus_seed}；{prompt}"
        elif len(prompt) <= 8:
            prompt = focus_seed

    if prompt:
        base["prompt"] = prompt
        if len(prompt) <= 28:
            base["title"] = prompt

    if nodes:
        base["title"] = dedupe_atomic_title(str(base.get("title") or ""), nodes)
        base["canvas_context"] = format_canvas_context_line(nodes)

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
