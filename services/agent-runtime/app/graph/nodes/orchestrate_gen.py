"""Orchestrate topological image generation with bounded concurrency."""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.topo import topo_sort_image_keys

DEFAULT_MAX_CONCURRENCY = 3


def make_orchestrate_gen_node(
    *,
    nest: Any,
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
) -> Callable:
    async def orchestrate_gen(state: dict) -> dict:
        manifest = list(state.get("split_manifest") or [])
        by_key = {str(item["key"]): item for item in manifest if item.get("key")}

        try:
            ordered_keys = topo_sort_image_keys(manifest)
        except ValueError as exc:
            return {
                "phase": "orchestrate_gen",
                "gen_queue": [],
                "gen_completed": list(state.get("gen_completed") or []),
                "gen_failed": [
                    *(state.get("gen_failed") or []),
                    {"key": None, "reason": str(exc)},
                ],
                "last_error": str(exc),
                "messages": [AIMessage(content=f"出图编排失败：{exc}")],
            }

        gen_queue = [
            str(by_key[k]["node_id"])
            for k in ordered_keys
            if by_key.get(k) and by_key[k].get("node_id")
        ]
        key_set = set(ordered_keys)
        deps_of = {
            k: [str(d) for d in (by_key[k].get("depends_on") or []) if str(d) in key_set]
            for k in ordered_keys
        }

        completed_keys: set[str] = set()
        failed_keys: set[str] = set()
        gen_completed: list[str] = []
        gen_failed: list[dict] = []
        sem = asyncio.Semaphore(max(1, max_concurrency))
        remaining = set(ordered_keys)
        in_flight: dict[str, asyncio.Task] = {}

        async def run_one(key: str) -> tuple[str, str, str | None]:
            item = by_key[key]
            node_id = item.get("node_id")
            if not node_id:
                return key, "fail", "missing_node_id"
            async with sem:
                try:
                    await nest.run_image_generation(str(node_id))
                    return key, "ok", None
                except Exception as exc:  # noqa: BLE001 — record per-node failure
                    return key, "fail", str(exc)

        while remaining or in_flight:
            for key in sorted(remaining):
                deps = deps_of[key]
                if any(d in failed_keys for d in deps):
                    remaining.discard(key)
                    failed_keys.add(key)
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": by_key[key].get("node_id"),
                            "reason": "dependency_failed",
                        }
                    )
                    continue
                if not all(d in completed_keys for d in deps):
                    continue
                remaining.discard(key)
                in_flight[key] = asyncio.create_task(run_one(key))

            if not in_flight:
                # unmet deps that never failed (e.g. missing keys) — skip rest
                for key in sorted(remaining):
                    failed_keys.add(key)
                    gen_failed.append(
                        {
                            "key": key,
                            "node_id": by_key[key].get("node_id"),
                            "reason": "dependency_failed",
                        }
                    )
                remaining.clear()
                break

            done, _ = await asyncio.wait(
                in_flight.values(), return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                key, status, err = task.result()
                del in_flight[key]
                item = by_key[key]
                node_id = str(item.get("node_id") or key)
                if status == "ok":
                    completed_keys.add(key)
                    gen_completed.append(node_id)
                else:
                    failed_keys.add(key)
                    gen_failed.append(
                        {"key": key, "node_id": node_id, "reason": err or "failed"}
                    )

        msg = (
            f"自动出图完成：成功 {len(gen_completed)}，失败/跳过 {len(gen_failed)}。"
            if gen_queue
            else "无可自动出图的图片节点。"
        )
        return {
            "phase": "orchestrate_gen",
            "gen_queue": gen_queue,
            "gen_completed": gen_completed,
            "gen_failed": gen_failed,
            "messages": [AIMessage(content=msg)],
        }

    return orchestrate_gen
