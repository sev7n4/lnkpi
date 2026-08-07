"""P4: create draft canvas node for atomic create flow."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.sidebar_copy import format_atomic_create_progress


def _atomic_batch_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    batch: list[dict[str, Any]] = []
    for idx, item in enumerate(items):
        target_type = str(item.get("target_type") or "image")
        prompt = str(item.get("prompt") or "").strip()
        title = str(item.get("title") or prompt[:24] or target_type)
        batch.append(
            {
                "key": f"atomic_{target_type}_{idx}",
                "title": title,
                "targetType": target_type,
                "prompt": prompt,
                **(
                    {"pipeline": item["pipeline"]}
                    if item.get("pipeline")
                    else {}
                ),
                **(
                    {"imageAspect": item["imageAspect"]}
                    if item.get("imageAspect")
                    else {}
                ),
            }
        )
    return batch


async def _emit_atomic_task_list(nest: Any, created_items: list[dict[str, Any]]) -> None:
    emit_list = getattr(nest, "emit_task_list", None)
    if emit_list is None:
        return
    tasks: list[dict[str, Any]] = []
    for idx, item in enumerate(created_items):
        node_id = str(item.get("node_id") or "").strip()
        if not node_id:
            continue
        title = str(item.get("title") or item.get("target_type") or f"任务{idx + 1}")
        tasks.append(
            {
                "id": f"atomic-{node_id}",
                "title": title,
                "status": "pending",
                "nodeId": node_id,
            }
        )
    if tasks:
        await emit_list(tasks)


def make_create_atomic_node(*, nest: Any) -> Callable:
    async def create_atomic_node(state: dict) -> dict:
        items = [dict(i) for i in (state.get("atomic_items") or []) if isinstance(i, dict)]
        spec = state.get("atomic_spec") or {}
        if not items:
            items = [dict(spec)]

        add_fn = getattr(nest, "add_nodes_batch", None)
        if add_fn is None:
            return {
                "phase": "error",
                "messages": [AIMessage(content="无法创建画布节点。")],
            }
        try:
            batch = await add_fn(_atomic_batch_items(items))
        except Exception as exc:  # noqa: BLE001
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=f"创建节点失败：{exc}")],
            }

        nodes = batch.get("nodes") if isinstance(batch, dict) else None
        if not isinstance(nodes, list) or not nodes:
            return {
                "phase": "error",
                "messages": [AIMessage(content="创建节点失败：未返回 nodeId。")],
            }

        key_to_id = {
            str(n.get("key") or ""): str(n.get("nodeId") or "").strip()
            for n in nodes
            if isinstance(n, dict)
        }
        created_items: list[dict[str, Any]] = []
        for idx, item in enumerate(items):
            key = f"atomic_{str(item.get('target_type') or 'image')}_{idx}"
            node_id = key_to_id.get(key)
            if not node_id:
                return {
                    "phase": "error",
                    "messages": [AIMessage(content="创建节点失败：未返回 nodeId。")],
                }
            created = dict(item)
            created["node_id"] = node_id
            created_items.append(created)

        await _emit_atomic_task_list(nest, created_items)

        node_ids = [str(i.get("node_id") or "") for i in created_items if i.get("node_id")]

        attachments = state.get("sidebar_attachments") or []
        if attachments:
            apply_fn = getattr(nest, "apply_sidebar_attachments", None)
            if apply_fn and node_ids:
                await apply_fn(
                    node_ids=node_ids,
                    attachments=attachments,
                    ref_order=state.get("sidebar_ref_order"),
                    mode="localRefs",
                )

        keys = state.get("sidebar_mentioned_keys") or []
        if keys and node_ids:
            update_fn = getattr(nest, "update_nodes_batch", None)
            if update_fn is not None:
                await update_fn(
                    [
                        {"nodeId": nid, "patch": {"mentionedKeys": keys}}
                        for nid in node_ids
                    ]
                )

        first = created_items[0]
        msg = format_atomic_create_progress(first, count=len(created_items))

        return {
            "phase": "atomic_create",
            "atomic_node_id": str(first.get("node_id") or ""),
            "atomic_spec": first,
            "atomic_items": created_items,
            "messages": [AIMessage(content=msg)],
        }

    return create_atomic_node
