"""Single source of truth for resolving canvas node references from user text."""

from __future__ import annotations

import re
from typing import Any

from app.graph.explore_route import has_canvas_node_id_reference

_NODE_ID_PATTERN = re.compile(
    r"\b((?:prompt|image|text|video|audio|group)-[\w-]+)\b",
    re.IGNORECASE,
)

_QUOTED_TITLE_PATTERN = re.compile(r"[「『\"]([^」』\"]+)[」』\"]")

_PREFIX_RANGE_PATTERN = re.compile(
    r"([\u4e00-\u9fff\w]+)(\d+)\s*(?:到|至|-)\s*(\d+)",
)

_QUERY_PREFIXES = ("查询", "看看", "列出", "检查", "定位")


def extract_quoted_title(text: str) -> str | None:
    match = _QUOTED_TITLE_PATTERN.search(text or "")
    return match.group(1).strip() if match else None


def _nodes_from_summary(summary: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(summary, dict):
        return []
    nodes = summary.get("nodes") or summary.get("nodeSummaries") or []
    if not isinstance(nodes, list):
        return []
    return [n for n in nodes if isinstance(n, dict)]


def _node_id_from_dict(node: dict[str, Any]) -> str | None:
    nid = str(node.get("id") or node.get("nodeId") or "").strip()
    return nid or None


def _resolve_by_title_fragment(summary: dict[str, Any] | None, fragment: str) -> str | None:
    frag = (fragment or "").strip()
    if not frag:
        return None
    for node in _nodes_from_summary(summary):
        node_title = str(node.get("title") or node.get("label") or "")
        if frag in node_title or node_title in frag:
            nid = _node_id_from_dict(node)
            if nid:
                return nid
    return None


def _first_explicit_node_id(text: str) -> str | None:
    match = _NODE_ID_PATTERN.search(text or "")
    return match.group(1) if match else None


def _all_explicit_node_ids(text: str) -> list[str]:
    return _NODE_ID_PATTERN.findall(text or "")


def _resolve_prefix_range(text: str, summary: dict[str, Any] | None) -> list[str]:
    match = _PREFIX_RANGE_PATTERN.search(text or "")
    if not match:
        return []
    prefix, start_s, end_s = match.group(1), int(match.group(2)), int(match.group(3))
    for qp in _QUERY_PREFIXES:
        if prefix.startswith(qp):
            prefix = prefix[len(qp) :]
            break
    if end_s < start_s:
        start_s, end_s = end_s, start_s
    wanted_titles = {f"{prefix}{i}" for i in range(start_s, end_s + 1)}
    out: list[str] = []
    for node in _nodes_from_summary(summary):
        title = str(node.get("title") or node.get("label") or "")
        if title in wanted_titles:
            nid = _node_id_from_dict(node)
            if nid and nid not in out:
                out.append(nid)
    return out


def resolve_node_ref(text: str, summary: dict[str, Any] | None) -> str | None:
    """Resolve a single node id from user text and canvas summary."""
    u = text or ""

    explicit = _first_explicit_node_id(u)
    if explicit:
        return explicit

    quoted = extract_quoted_title(u)
    if quoted:
        by_quote = _resolve_by_title_fragment(summary, quoted)
        if by_quote:
            return by_quote

    for node in _nodes_from_summary(summary):
        title = str(node.get("title") or node.get("label") or "")
        if title and title in u:
            nid = _node_id_from_dict(node)
            if nid:
                return nid

    return None


def resolve_node_refs(text: str, summary: dict[str, Any] | None) -> list[str]:
    """Resolve zero or more node ids (explicit ids, prefix ranges, quoted titles)."""
    u = text or ""
    out: list[str] = []

    for nid in _all_explicit_node_ids(u):
        if nid not in out:
            out.append(nid)
    if out:
        return out

    for nid in _resolve_prefix_range(u, summary):
        if nid not in out:
            out.append(nid)
    if out:
        return out

    quoted = extract_quoted_title(u)
    if quoted:
        single = _resolve_by_title_fragment(summary, quoted)
        if single:
            return [single]

    single = resolve_node_ref(u, summary)
    return [single] if single else []


def text_has_node_reference(text: str) -> bool:
    """True when text likely references an existing canvas node."""
    return bool(has_canvas_node_id_reference(text) or extract_quoted_title(text))
