"""Start generation DAG: compute topological order and prepare generation state."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.topo import topo_sort_gen_keys


def make_start_gen_node() -> Callable:
    """Create start_gen node that initializes generation state.

    This node computes topological order and sets up the generation queue.
    The actual generation is handled by orchestrate_gen node (existing implementation).
    """

    async def start_gen(state: dict) -> dict:
        manifest = list(state.get("split_manifest") or [])
        if not manifest:
            return {
                "phase": "done",
                "messages": [AIMessage(content="无可自动生成的图片/视频节点。")],
            }

        by_key = {str(item["key"]): item for item in manifest if item.get("key")}

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

        # Initialize gen_queue with all keys
        # orchestrate_gen will handle the actual generation
        return {
            "gen_queue": ordered_keys,
            "gen_completed": [],
            "gen_failed": [],
            "messages": [AIMessage(content=f"开始按拓扑出图，共 {len(ordered_keys)} 个节点…")],
        }

    return start_gen