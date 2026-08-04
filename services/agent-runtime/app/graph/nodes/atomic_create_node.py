"""P4: create draft canvas node for atomic create flow."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


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
            }
        )
    return batch


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

        first = created_items[0]
        target_type = str(first.get("target_type") or "image")
        count = len(created_items)
        if count == 1:
            msg = f"已创建 {target_type} 节点，准备生产。"
        else:
            msg = f"已创建 {count} 个 {target_type} 节点，准备生产。"

        return {
            "phase": "atomic_create",
            "atomic_node_id": str(first.get("node_id") or ""),
            "atomic_spec": first,
            "atomic_items": created_items,
            "messages": [AIMessage(content=msg)],
        }

    return create_atomic_node
