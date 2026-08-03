"""W27: Graph control-flow replay — checkpoint phase timeline (not canvas replay)."""

from __future__ import annotations

from typing import Any


def _phase_entry(
    *,
    step: Any,
    source: Any,
    phase: str | None,
    next_nodes: list[str],
    skill_id: Any,
    prompt_version: Any,
) -> dict[str, Any]:
    return {
        "step": int(step) if step is not None else None,
        "source": str(source) if source is not None else None,
        "phase": phase,
        "nextNodes": next_nodes,
        "skillId": str(skill_id) if skill_id else None,
        "promptVersion": str(prompt_version) if prompt_version else None,
        "interrupted": bool(next_nodes),
    }


async def get_thread_timeline(
    thread_id: str,
    *,
    graph: Any,
    limit: int = 100,
) -> dict[str, Any]:
    """List phase transitions from LangGraph checkpoint history (newest→oldest scan)."""
    config = {"configurable": {"thread_id": thread_id}}
    raw: list[dict[str, Any]] = []
    async for snap in graph.aget_state_history(config, limit=limit):
        vals = getattr(snap, "values", None) or {}
        meta = getattr(snap, "metadata", None) or {}
        phase = vals.get("phase")
        phase_str = str(phase) if phase is not None else None
        next_nodes = [str(n) for n in (getattr(snap, "next", None) or [])]
        raw.append(
            _phase_entry(
                step=meta.get("step"),
                source=meta.get("source"),
                phase=phase_str,
                next_nodes=next_nodes,
                skill_id=vals.get("skill_id"),
                prompt_version=vals.get("prompt_version"),
            )
        )

    raw.reverse()
    timeline: list[dict[str, Any]] = []
    last_phase: str | None = None
    for entry in raw:
        if entry["phase"] != last_phase:
            timeline.append(entry)
            last_phase = entry["phase"]

    return {
        "threadId": thread_id,
        "entries": timeline,
        "checkpointCount": len(raw),
    }
