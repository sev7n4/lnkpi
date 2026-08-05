"""Render ContextPacket to markdown for LLM consumption."""

from __future__ import annotations

from typing import Any

from app.graph.context_packet import ContextPacket

_BUDGET_TOTAL = 500


def render_packet_for_llm(packet: ContextPacket | None, *, stage: str = "parse") -> str:
    """Serialize packet to markdown blocks for parse/plan LLM user blocks."""
    if not packet:
        return ""

    lines: list[str] = []
    dropped: list[str] = list((packet.get("meta") or {}).get("dropped_sections") or [])

    active = packet.get("active") or {}
    utterance = str(active.get("utterance") or "").strip()
    if utterance:
        lines.append("## 当前请求")
        lines.append(utterance)

    task = packet.get("task")
    if task:
        lines.append("")
        lines.append("## 任务上下文")
        if task.get("note"):
            lines.append(str(task["note"]))
        else:
            parts = [f"kind: {task.get('kind', 'atomic')}"]
            if task.get("prior_title"):
                parts.append(f"prior: {task['prior_title']} ({task.get('prior_target_type', 'image')})")
            if task.get("style_inherit"):
                parts.append("style_inherit: true")
            lines.append("；".join(parts))

    canvas = packet.get("canvas") or {}
    if canvas:
        lines.append("")
        lines.append("## 画布（摘要）")
        if canvas.get("selected_node"):
            sn = canvas["selected_node"]
            lines.append(
                f"选中: [{sn.get('type')}] {sn.get('title')} (id={sn.get('id')})"
            )
            if sn.get("prompt_hint"):
                lines.append(f"prompt_hint: {sn['prompt_hint']}")
        elif canvas.get("stats_line"):
            lines.append(str(canvas["stats_line"]))
        else:
            counts = canvas.get("type_counts") or {}
            count_str = ", ".join(f"{k}×{v}" for k, v in sorted(counts.items()))
            lines.append(f"共 {canvas.get('node_count', 0)} 节点（{count_str}）")
        for node in canvas.get("relevant_nodes") or []:
            if canvas.get("selected_node"):
                continue
            status = f", status={node['status']}" if node.get("status") else ""
            lines.append(f"- [{node.get('type')}] {node.get('title')} (id={node.get('id')}{status})")

    episodic = packet.get("episodic")
    if episodic and episodic.get("turns"):
        lines.append("")
        lines.append("## 近期（摘要）")
        for turn in episodic["turns"]:
            lines.append(
                f"用户: {turn.get('user', '')} → 助手: {turn.get('assistant_summary', '')}"
            )
    elif "episodic" in dropped:
        pass  # intentionally omitted

    if stage == "parse":
        meta = packet.get("meta") or {}
        if meta.get("topic_switch"):
            lines.append("")
            lines.append("## 规则")
            lines.append("仅解析「当前请求」；勿继承无关历史主题。")

    text = "\n".join(lines).strip()
    if len(text) > _BUDGET_TOTAL:
        text = text[: _BUDGET_TOTAL - 1] + "…"
        meta = packet.setdefault("meta", {})
        meta["char_budget_used"] = _BUDGET_TOTAL
        meta.setdefault("dropped_sections", []).append("truncated")
    else:
        meta = packet.setdefault("meta", {})
        meta["char_budget_used"] = len(text)
    return text
