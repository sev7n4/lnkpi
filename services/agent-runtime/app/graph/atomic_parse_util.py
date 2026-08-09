"""P4-04/05: atomic utterance parse — prompt extraction, canvas context, few-shots."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from app.graph.few_shot import load_few_shots
from app.graph.atomic_intent import (
    apply_regenerate_adjust,
    build_atomic_spec,
    confirm_gate_for_type,
    detect_regenerate_adjust,
    parse_atomic_target_type,
)

_DEICTIC_HINTS = (
    "这个",
    "这张",
    "那个",
    "那张",
    "该",
    "主图",
    "当前",
    "刚才",
    "同样风格",
    "同样",
    "上一张",
)
_STYLE_INHERIT_HINTS = ("同样风格", "刚才那个风格", "按刚才", "跟刚才一样", "一样风格")

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


def format_canvas_context_line(nodes: list[dict[str, Any]], *, include_titles: bool = True) -> str:
    """Compact canvas stats for parse context (P4-05)."""
    if not nodes:
        return "画布为空"
    by_type: dict[str, int] = {}
    for node in nodes:
        kind = str(node.get("type") or "unknown")
        by_type[kind] = by_type.get(kind, 0) + 1
    counts = ", ".join(f"{k}×{v}" for k, v in sorted(by_type.items()))
    title_bit = ""
    if include_titles:
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


def style_seed_from_context(parse_context: str | None) -> str | None:
    """Pull prior user topic from compact dialogue summary for style inheritance."""
    ctx = (parse_context or "").strip()
    if not ctx:
        return None
    if "## 近期" in ctx:
        for line in ctx.splitlines():
            line = line.strip()
            if not line.startswith("用户:"):
                continue
            user_part = line.split("用户:", 1)[1].split("→", 1)[0].strip()
            if user_part and len(user_part) >= 4:
                return user_part[:80]
    if "近期对话:" not in ctx:
        return None
    tail = ctx.split("近期对话:", 1)[1]
    for chunk in tail.split("；"):
        if "用户:" not in chunk:
            continue
        user_part = chunk.split("用户:", 1)[1].split("→助手:", 1)[0].strip()
        if user_part and len(user_part) >= 4:
            return user_part[:80]
    return None


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


_CN_COUNT = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}

_MULTI_ENUM_MARKERS = ("分别是", "分别为", "包括")


def _parse_cn_count(token: str) -> int | None:
    token = (token or "").strip()
    if not token:
        return None
    if token.isdigit():
        n = int(token)
        return n if n >= 2 else None
    if token in _CN_COUNT:
        n = _CN_COUNT[token]
        return n if n >= 2 else None
    if len(token) == 2 and token[0] == "十" and token[1] in _CN_COUNT:
        return 10 + _CN_COUNT[token[1]]
    return None


def _split_atomic_item_labels(text: str) -> list[str]:
    parts = re.split(r"[、，,；;]+", text or "")
    return [p.strip() for p in parts if p.strip()]


def parse_atomic_multi_items(utterance: str) -> list[dict[str, Any]] | None:
    """Split enumerated multi-image requests into per-node atomic specs."""
    t = (utterance or "").strip()
    if not t:
        return None
    if parse_atomic_target_type(t) != "image":
        return None

    count_m = re.search(r"([一二三四五六七八九十两\d]+)张(?:图|图片)", t)
    expected = _parse_cn_count(count_m.group(1)) if count_m else None
    if expected is not None and expected < 2:
        return None

    labels: list[str] | None = None
    for marker in _MULTI_ENUM_MARKERS:
        if marker not in t:
            continue
        tail = t.split(marker, 1)[1].lstrip("：: ").rstrip("。. ")
        labels = _split_atomic_item_labels(tail)
        break

    if labels is None:
        colon_m = re.search(r"张(?:图|图片)[：:，,]\s*(.+?)[。.]?$", t)
        if colon_m and expected and expected >= 2:
            labels = _split_atomic_item_labels(colon_m.group(1))

    if not labels or len(labels) < 2:
        variant_markers = ("不同颜色", "多种颜色", "各色", "不同风格", "多种风格", "不同款式")
        has_variant = any(m in t for m in variant_markers)
        has_ref = bool(re.search(r"@I\d|参考|参照|这张图|这个图", t, re.IGNORECASE))
        if expected is not None and expected >= 2 and (has_variant or has_ref):
            base = re.sub(r"^@I\d+\s*[，,]?\s*", "", t).strip()
            return [
                {
                    "target_type": "image",
                    "prompt": f"{base}（变体 {i + 1}/{expected}）".strip(),
                    "title": f"变体{i + 1}",
                    "confirm_gate": False,
                }
                for i in range(expected)
            ]
        return None
    if expected is not None and expected != len(labels):
        return None

    return [
        {
            "target_type": "image",
            "prompt": label,
            "title": label,
            "confirm_gate": False,
        }
        for label in labels
    ]


def build_atomic_items_enriched(
    utterance: str,
    *,
    canvas_summary: dict[str, Any] | None = None,
    focus_node_id: str | None = None,
) -> list[dict[str, Any]] | None:
    """Multi-image parse with canvas title dedupe applied per item."""
    items = parse_atomic_multi_items(utterance)
    if not items:
        return None
    nodes = canvas_summary_nodes(canvas_summary)
    if not nodes:
        return items
    enriched: list[dict[str, Any]] = []
    seen_titles = _existing_titles(nodes)
    for item in items:
        copy = dict(item)
        title = str(copy.get("title") or "").strip()
        if title and title in seen_titles:
            for i in range(2, 20):
                candidate = f"{title} ({i})"
                if candidate not in seen_titles:
                    copy["title"] = candidate
                    seen_titles.add(candidate)
                    break
        elif title:
            seen_titles.add(title)
        enriched.append(copy)
    return enriched


def build_variant_spec_from_checkpoint(
    utterance: str,
    prior_spec: dict[str, Any],
    *,
    canvas_summary: dict[str, Any] | None = None,
    parse_context: str | None = None,
) -> dict[str, Any]:
    """Derive a new-node atomic spec from checkpoint + variant/adjust utterance."""
    adjust = detect_regenerate_adjust(utterance)
    spec = apply_regenerate_adjust(prior_spec, adjust, parse_context=parse_context)
    nodes = canvas_summary_nodes(canvas_summary)
    title = str(spec.get("title") or spec.get("prompt") or "节点").strip()
    if nodes and title:
        spec["title"] = dedupe_atomic_title(title, nodes)
    if parse_context:
        spec["canvas_context"] = parse_context
    elif nodes:
        spec["canvas_context"] = format_canvas_context_line(nodes)
    return spec


def extract_atomic_prompt(utterance: str) -> str:
    """Strip leading atomic hint prefixes; keep semantic payload for node prompt."""
    original = (utterance or "").strip()
    if not original:
        return ""
    t = original
    for prefix in sorted(_STRIP_PREFIXES, key=len, reverse=True):
        if t.startswith(prefix):
            t = t[len(prefix) :].strip()
            break
    t = re.sub(r'^["「『](.+?)["」』]', r"\1", t).strip()
    # Avoid collapsing vo/audio requests to bare modality labels (e.g. 「旁白」)
    if len(t) < 4 and len(original) >= 4:
        return original
    return t or original


def build_atomic_spec_enriched(
    utterance: str,
    *,
    canvas_summary: dict[str, Any] | None = None,
    focus_node_id: str | None = None,
    parse_context: str | None = None,
    mentioned_keys: list[str] | None = None,
) -> dict[str, Any]:
    """Keyword routing + prompt/title cleanup + canvas context (P4-04/05)."""
    nodes = canvas_summary_nodes(canvas_summary)
    base = build_atomic_spec(utterance, mentioned_keys=mentioned_keys)
    prompt = extract_atomic_prompt(utterance)
    if base.get("prompt") and base["prompt"] != utterance:
        prompt = str(base["prompt"])
    focus_seed = resolve_focus_seed(utterance, focus_node_id, nodes)
    if focus_seed:
        if "扩写" in utterance or base.get("target_type") == "prompt":
            if not prompt or prompt in ("这个主图 prompt", "主图 prompt", "这个主图"):
                prompt = focus_seed
            elif focus_seed not in prompt:
                prompt = f"{focus_seed}；{prompt}"
        elif len(prompt) <= 8:
            prompt = focus_seed

    if any(h in utterance for h in _STYLE_INHERIT_HINTS):
        style_seed = style_seed_from_context(parse_context)
        if style_seed and style_seed not in (prompt or ""):
            prompt = f"{style_seed}；{prompt}" if prompt else style_seed

    if prompt:
        base["prompt"] = prompt
        if len(prompt) <= 28:
            base["title"] = prompt

    if nodes:
        base["title"] = dedupe_atomic_title(str(base.get("title") or ""), nodes)

    ctx_line = parse_context or (format_canvas_context_line(nodes) if nodes else None)
    if ctx_line:
        base["canvas_context"] = ctx_line

    return base


_VAGUE_UTTERANCES = frozenset({
    "帮我生成",
    "生成一下",
    "做一个",
    "来一张",
    "来一段",
    "帮我做一张",
})

_STRONG_SIGNAL_KEYWORDS = (
    "人物图",
    "白底",
    "主图",
    "三视图",
    "海报",
    "banner",
    "分镜",
    "旁白",
    "配音",
    "视频",
    "prompt",
    "文案",
    "脚本",
    "广告词",
    "模特",
)


def rule_parse_confidence(
    utterance: str,
    spec: dict[str, Any],
    multi_items: list[dict[str, Any]] | None,
) -> float:
    """Heuristic confidence for rule-only parse (Phase 2 fast path)."""
    from app.graph.atomic_intent_ir import has_modality_conflict_risk
    from app.graph.planning_guard import planning_guard_confidence_cap

    t = (utterance or "").strip()
    if has_modality_conflict_risk(t):
        return planning_guard_confidence_cap(t, 0.84)
    if multi_items and len(multi_items) >= 2:
        conf = 0.98
    elif not t or t in _VAGUE_UTTERANCES:
        conf = 0.40
    elif spec.get("target_type") in ("video", "audio"):
        conf = 0.95
    elif len(str(spec.get("prompt") or "").strip()) < 4:
        conf = 0.50
    elif any(k in t for k in _STRONG_SIGNAL_KEYWORDS):
        conf = 0.96
    else:
        from app.graph.atomic_intent import atomic_create_intent

        conf = 0.88 if atomic_create_intent(t) else 0.55
    return planning_guard_confidence_cap(t, conf)


def rule_parse_atomic(
    utterance: str,
    *,
    canvas_summary: dict[str, Any] | None = None,
    focus_node_id: str | None = None,
    parse_context: str | None = None,
    mentioned_keys: list[str] | None = None,
) -> tuple[list[dict[str, Any]], float]:
    """Rule-based parse returning items + confidence."""
    multi_items = build_atomic_items_enriched(
        utterance,
        canvas_summary=canvas_summary,
        focus_node_id=focus_node_id,
    )
    if multi_items:
        return multi_items, rule_parse_confidence(utterance, multi_items[0], multi_items)
    spec = build_atomic_spec_enriched(
        utterance,
        canvas_summary=canvas_summary,
        focus_node_id=focus_node_id,
        parse_context=parse_context,
        mentioned_keys=mentioned_keys,
    )
    return [spec], rule_parse_confidence(utterance, spec, None)


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
