"""Diagnostic helpers for LangGraph checkpoint / atomic context observability."""

from __future__ import annotations

from typing import Any


def has_atomic_checkpoint(vals: dict[str, Any] | None) -> bool:
    if not isinstance(vals, dict):
        return False
    return bool(str(vals.get("atomic_node_id") or "").strip()) and isinstance(
        vals.get("atomic_spec"), dict
    )


def checkpoint_diagnostics(vals: dict[str, Any] | None) -> dict[str, Any]:
    """Compact snapshot for logs and thread-state API (no full atomic_spec payload)."""
    if not isinstance(vals, dict):
        vals = {}
    node_id = str(vals.get("atomic_node_id") or "").strip() or None
    spec = vals.get("atomic_spec") if isinstance(vals.get("atomic_spec"), dict) else None
    title = str(spec.get("title") or "")[:40] if spec else None
    target = str(spec.get("target_type") or "") if spec else None
    return {
        "hasAtomicCheckpoint": has_atomic_checkpoint(vals),
        "atomicNodeId": node_id,
        "atomicTargetType": target or None,
        "atomicTitle": title or None,
        "flowMode": vals.get("flow_mode"),
        "phase": vals.get("phase"),
    }
