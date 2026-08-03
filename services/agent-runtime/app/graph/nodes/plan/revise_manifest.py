"""revise_manifest: LLM call for node operations (rename/add/delete).

Conditional LLM node: only performs work when is_node_revise is True.
Otherwise returns an empty dict (transparent passthrough) so the linear
pipeline can stay fully wired without conditional routing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.graph.nodes.plan._shared import latest_user_text, revise_operations_via_llm


def make_revise_manifest_node(*, llm: Any, skills_dir: Path) -> Callable:
    """Create the revise_manifest node."""

    async def revise_manifest(state: dict) -> dict:
        is_node_revise = state.get("is_node_revise")
        if not is_node_revise:
            # Not in node_revise mode → transparent passthrough
            return {"node_operations": None}

        user_text = latest_user_text(state.get("messages") or [])
        split_manifest = list(state.get("split_manifest") or [])

        ops = await revise_operations_via_llm(
            llm=llm,
            split_manifest=split_manifest,
            user_text=user_text,
            skill_id=str(state.get("skill_id") or "") or None,
            skills_dir=skills_dir,
        )

        return {"node_operations": ops}

    return revise_manifest
