"""Source-of-truth resolution for copy alignment — decoupled from checkpoint gaps."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.graph.intent import marketing_intent


@dataclass(frozen=True)
class CopySoT:
    user_brief: str
    plan_draft: str


def _role(msg: Any) -> str | None:
    return getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)


def _content(msg: Any) -> str:
    raw = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
    return str(raw or "").strip()


def brief_from_messages(messages: list[Any]) -> str:
    """First substantive marketing user turn — fallback when checkpoint brief is empty."""
    candidates: list[str] = []
    for msg in messages or []:
        if _role(msg) not in ("human", "user"):
            continue
        text = _content(msg)
        if not text or text in ("1", "2", "3"):
            continue
        if any(
            kw in text
            for kw in ("写入主文案", "确认出图", "确认方案", "确认写入", "采纳推荐")
        ):
            continue
        candidates.append(text)
    for text in candidates:
        if marketing_intent(text):
            return text
    return candidates[0] if candidates else ""


def plan_content_from_node(node: dict[str, Any]) -> str:
    data = node.get("data")
    if isinstance(data, dict):
        for key in ("content", "text", "prompt"):
            val = str(data.get(key) or "").strip()
            if len(val) > 15:
                return val
    for key in ("content", "text", "prompt"):
        val = str(node.get(key) or "").strip()
        if len(val) > 15:
            return val
    return ""


async def resolve_copy_sot(state: dict, nest: Any | None = None) -> CopySoT:
    """Resolve brief + plan from state, snapshot fields, DB snapshot, messages, canvas."""
    from app.graph.context_snapshot import (
        brief_from_snapshot,
        load_context_snapshot,
        plan_summary_from_snapshot,
    )

    brief = str(
        state.get("user_brief") or state.get("copy_sot_brief") or ""
    ).strip()
    plan = str(state.get("plan_draft") or state.get("copy_sot_plan") or "").strip()

    thread_id = str(state.get("thread_id") or "").strip()
    if nest is not None and thread_id and (not brief or not plan):
        snap = await load_context_snapshot(nest, thread_id, stage="split")
        if snap is None and not brief:
            snap = await load_context_snapshot(nest, thread_id, stage="plan")
        if snap:
            if not brief:
                brief = brief_from_snapshot(snap)
            if not plan:
                plan_summary = plan_summary_from_snapshot(snap)
                if plan_summary:
                    plan = plan_summary

    if not brief:
        brief = brief_from_messages(list(state.get("messages") or []))

    if not plan and nest is not None:
        plan_node_id = str(state.get("plan_node_id") or "").strip()
        if plan_node_id:
            get_node = getattr(nest, "get_node", None)
            if get_node is not None:
                try:
                    node = await get_node(plan_node_id)
                    plan = plan_content_from_node(node).strip()
                except Exception:  # noqa: BLE001 — canvas read is best-effort fallback
                    pass

    return CopySoT(user_brief=brief, plan_draft=plan)


def snapshot_copy_sot_fields(state: dict) -> dict[str, str | None]:
    """Persist SoT snapshot at plan write / split for later copy nodes."""
    brief = str(state.get("user_brief") or state.get("copy_sot_brief") or "").strip()
    plan = str(state.get("plan_draft") or state.get("copy_sot_plan") or "").strip()
    if not brief and not plan:
        brief = brief_from_messages(list(state.get("messages") or []))
    out: dict[str, str | None] = {}
    if brief:
        out["copy_sot_brief"] = brief
    if plan:
        out["copy_sot_plan"] = plan
    return out
