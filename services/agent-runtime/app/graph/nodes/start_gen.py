"""Start generation: compute topological order + dependency graph, init W3 state.

Writes the Send-API generation fields consumed by ``gen_scheduler`` /
``gen_node`` / ``collect_gen``. The reducer-backed accumulators
(``gen_*_keys`` / ``gen_fail_details``) are reset to ``None`` here so a
re-generation on the same thread does not leak the previous run's keys.
"""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.topo import topo_sort_gen_keys


def make_start_gen_node(*, nest: Any = None, max_concurrency: int = 3) -> Callable:
    """Create start_gen node. ``max_concurrency`` caps parallel gen_node per superstep."""

    async def start_gen(state: dict) -> dict:
        commit_fn = getattr(nest, "commit_stage", None) if nest is not None else None
        if commit_fn is not None:
            try:
                await commit_fn()
            except Exception:  # noqa: BLE001
                pass

        manifest = list(state.get("split_manifest") or [])
        if not manifest:
            return {
                "phase": "done",
                "messages": [AIMessage(content="无可自动生成的图片/视频节点。")],
            }

        by_key = {str(it["key"]): it for it in manifest if it.get("key")}

        ordered_keys = list(state.get("gen_ordered_keys") or [])
        if not ordered_keys:
            try:
                ordered_keys = topo_sort_gen_keys(manifest)
            except ValueError as exc:
                return {
                    "phase": "done",
                    "gen_failed": [{"key": None, "reason": str(exc)}],
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"出图编排失败：{exc}")],
                }

        if not ordered_keys:
            return {
                "phase": "done",
                "messages": [AIMessage(content="无可自动生成的图片/视频节点。")],
            }

        key_set = set(ordered_keys)
        deps_of = {
            k: [str(d) for d in (by_key[k].get("depends_on") or []) if str(d) in key_set]
            for k in ordered_keys
        }

        return {
            # write-once shared context (plain overwrite, no reducer)
            "gen_ordered_keys": ordered_keys,
            "gen_deps_of": deps_of,
            "gen_by_key": by_key,
            "gen_max_concurrency": max_concurrency,
            # reducer-backed accumulators: reset to None for a clean run
            "gen_completed_keys": None,
            "gen_failed_keys": None,
            "gen_needs_user_keys": None,
            "gen_fail_details": None,
            "messages": [AIMessage(content=f"开始按拓扑出图，共 {len(ordered_keys)} 个节点…")],
        }

    return start_gen
