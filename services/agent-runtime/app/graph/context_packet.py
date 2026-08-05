"""Structured context packets for LLM parse (replaces flat pipe-delimited strings)."""

from __future__ import annotations

from typing import Any, TypedDict

from app.graph.atomic_parse_util import (
    _DEICTIC_HINTS,
    _STYLE_INHERIT_HINTS,
    canvas_summary_nodes,
    format_canvas_context_line,
)
from app.graph.atomic_intent import is_regenerate_new_variant

# Budget limits (chars) — see docs/.../agent-context-engineering-design.md
_BUDGET_UTTERANCE = 200
_BUDGET_TASK = 80
_BUDGET_CANVAS_NODES = 150
_BUDGET_CANVAS_STATS = 60
_BUDGET_EPISODIC = 120
_MAX_RELEVANT_NODES = 3


class EpisodicTurn(TypedDict):
    user: str
    assistant_summary: str


class ContextPacket(TypedDict, total=False):
    active: dict[str, Any]
    task: dict[str, Any]
    canvas: dict[str, Any]
    episodic: dict[str, Any]
    meta: dict[str, Any]


def _latest_utterance(state: dict[str, Any]) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content).strip()
    return ""


def _has_deictic_reference(text: str) -> bool:
    return any(h in (text or "") for h in _DEICTIC_HINTS)


def _has_style_inherit(text: str) -> bool:
    return any(h in (text or "") for h in _STYLE_INHERIT_HINTS)


def _titles_overlap(utterance: str, prior_title: str) -> bool:
    prior = (prior_title or "").strip()
    new = (utterance or "").strip()
    if not prior or not new:
        return False
    if prior == new or prior in new or new in prior:
        return True
    prior_tokens = {t for t in prior.replace("，", " ").split() if len(t) >= 2}
    new_tokens = {t for t in new.replace("，", " ").split() if len(t) >= 2}
    return bool(prior_tokens & new_tokens)


def should_include_prior_task(utterance: str, prior_spec: dict[str, Any] | None) -> bool:
    if not prior_spec:
        return False
    if is_regenerate_new_variant(utterance):
        return True
    if _has_style_inherit(utterance):
        return True
    if _has_deictic_reference(utterance):
        return True
    title = str(prior_spec.get("title") or "")
    if _titles_overlap(utterance, title):
        return True
    return False


def should_include_episodic(utterance: str, prior_spec: dict[str, Any] | None) -> bool:
    if _has_style_inherit(utterance) or is_regenerate_new_variant(utterance):
        return True
    if _has_deictic_reference(utterance) and prior_spec:
        return True
    return False


def _summarize_assistant_for_context(content: str) -> str:
    """Semantic one-liner for episodic — not raw sidebar copy."""
    text = (content or "").strip().replace("\n", " ")
    if not text:
        return ""
    if "生成完成" in text or "已完成" in text:
        return "生成已完成"
    if "正在生成" in text or "已在画布创建" in text:
        return "正在生成"
    if "角色设定图" in text or "四格" in text:
        return "角色设定图处理中"
    if "确认" in text and "方案" in text:
        return "方案待确认"
    if len(text) > 80:
        return text[:77] + "…"
    return text


def _build_episodic_turns(messages: list[Any] | None, *, max_turns: int = 1) -> list[EpisodicTurn]:
    turns: list[EpisodicTurn] = []
    pending_user: str | None = None
    for msg in messages or []:
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        content = str(content or "").strip()
        if not content:
            continue
        if role in ("human", "user"):
            pending_user = content[:80] + ("…" if len(content) > 80 else "")
        elif role in ("ai", "assistant") and pending_user:
            turns.append(
                {
                    "user": pending_user,
                    "assistant_summary": _summarize_assistant_for_context(content),
                }
            )
            pending_user = None
    return turns[-max_turns:]


def _select_relevant_nodes(
    nodes: list[dict[str, Any]],
    *,
    focus_node_id: str | None,
    utterance: str,
) -> list[dict[str, Any]]:
    if focus_node_id:
        for node in nodes:
            if str(node.get("id") or "") == focus_node_id:
                return [node]
    if not nodes:
        return []
    # Prefer recently completed / generating image nodes when no focus
    scored: list[tuple[int, dict[str, Any]]] = []
    for node in nodes:
        status = str(node.get("status") or "").lower()
        score = 0
        if status in ("completed", "generating", "success"):
            score += 2
        if str(node.get("type") or "") == "image":
            score += 1
        scored.append((score, node))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [n for _, n in scored[:_MAX_RELEVANT_NODES]]


def build_parse_packet(
    state: dict[str, Any],
    *,
    canvas_summary: dict[str, Any] | None = None,
    utterance: str | None = None,
) -> ContextPacket:
    """Build structured context for parse-stage LLM."""
    text = (utterance or _latest_utterance(state)).strip()
    prior_spec = state.get("atomic_spec")
    prior = prior_spec if isinstance(prior_spec, dict) else None
    focus_node_id = str(state.get("focus_node_id") or "").strip() or None
    nodes = canvas_summary_nodes(canvas_summary)

    dropped: list[str] = []
    include_prior = should_include_prior_task(text, prior)
    include_episodic = should_include_episodic(text, prior)
    topic_switch = bool(prior and not include_prior and str(prior.get("title") or "").strip())

    packet: ContextPacket = {
        "active": {
            "utterance": text[:_BUDGET_UTTERANCE],
            "focus_node_id": focus_node_id,
            "thread_phase": str(state.get("phase") or "") or None,
            "flow_mode": str(state.get("flow_mode") or "") or None,
        },
        "meta": {
            "topic_switch": topic_switch,
            "dropped_sections": dropped,
            "char_budget_used": 0,
        },
    }

    if include_prior and prior:
        task: dict[str, Any] = {
            "kind": "atomic",
            "prior_title": str(prior.get("title") or "")[:32],
            "prior_target_type": str(prior.get("target_type") or "image"),
            "style_inherit": _has_style_inherit(text),
        }
        packet["task"] = task  # type: ignore[assignment]
    elif topic_switch:
        packet["task"] = {  # type: ignore[assignment]
            "kind": "atomic",
            "note": "新任务，与上轮 atomic 主题无关，勿继承上轮 prompt/title",
        }

    by_type: dict[str, int] = {}
    for node in nodes:
        kind = str(node.get("type") or "unknown")
        by_type[kind] = by_type.get(kind, 0) + 1

    relevant = _select_relevant_nodes(nodes, focus_node_id=focus_node_id, utterance=text)
    canvas_block: dict[str, Any] = {
        "node_count": len(nodes),
        "type_counts": by_type,
    }
    if topic_switch and nodes:
        canvas_block["stats_line"] = format_canvas_context_line(nodes, include_titles=False)[
            :_BUDGET_CANVAS_STATS
        ]
    elif relevant:
        canvas_block["relevant_nodes"] = [
            {
                "id": str(n.get("id") or ""),
                "type": str(n.get("type") or ""),
                "title": str(n.get("title") or "")[:32],
                **({"status": str(n.get("status"))} if n.get("status") else {}),
            }
            for n in relevant
        ]
        if focus_node_id and relevant:
            node = relevant[0]
            data = node.get("data") if isinstance(node.get("data"), dict) else {}
            hint = str(data.get("prompt") or data.get("content") or node.get("title") or "")[:60]
            canvas_block["selected_node"] = {
                "id": focus_node_id,
                "type": str(node.get("type") or ""),
                "title": str(node.get("title") or "")[:32],
                **({"prompt_hint": hint} if hint else {}),
            }
    elif nodes:
        canvas_block["stats_line"] = format_canvas_context_line(nodes)[:_BUDGET_CANVAS_STATS]

    if canvas_block.get("node_count") or canvas_block.get("relevant_nodes"):
        packet["canvas"] = canvas_block

    if include_episodic:
        turns = _build_episodic_turns(state.get("messages") or [], max_turns=1)
        if turns:
            packet["episodic"] = {"turns": turns, "max_turns": 1}
    else:
        dropped.append("episodic")

    return packet
