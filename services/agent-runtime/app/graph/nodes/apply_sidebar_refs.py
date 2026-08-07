from __future__ import annotations

from typing import Any, Callable


def _seed_target(manifest: list[dict[str, Any]]) -> str | None:
    for item in manifest:
        if (
            str(item.get("role") or "") == "seed"
            and str(item.get("target_type") or "") == "image"
            and str(item.get("node_id") or "").strip()
        ):
            return str(item["node_id"])
    return None


def _fallback_node_ids(manifest: list[dict[str, Any]]) -> list[str]:
    return [
        str(item["node_id"])
        for item in manifest
        if str(item.get("node_id") or "").strip()
    ]


def make_apply_sidebar_refs_node(*, nest: Any) -> Callable:
    """Apply per-turn sidebar references to a campaign after its split."""

    async def apply_sidebar_refs(state: dict) -> dict:
        attachments = state.get("sidebar_attachments") or []
        if not attachments:
            return {}

        manifest = [
            item for item in (state.get("split_manifest") or []) if isinstance(item, dict)
        ]
        target_id = _seed_target(manifest)
        apply_fn = getattr(nest, "apply_sidebar_attachments", None)
        if apply_fn is None:
            return {}

        if not target_id:
            fallback_ids = _fallback_node_ids(manifest)
            if fallback_ids:
                await apply_fn(
                    node_ids=fallback_ids,
                    attachments=attachments,
                    ref_order=state.get("sidebar_ref_order"),
                    mode="localRefs",
                )
            return {}

        result = await apply_fn(
            node_ids=[target_id],
            attachments=attachments,
            ref_order=state.get("sidebar_ref_order"),
            mode="attach_edges",
        )
        source_ids = result.get("sourceNodeIds") or []
        attach_fn = getattr(nest, "attach_refs", None)
        if source_ids and attach_fn is not None:
            await attach_fn(target_id, [str(node_id) for node_id in source_ids])
        return {}

    return apply_sidebar_refs
