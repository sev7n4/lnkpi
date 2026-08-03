"""P4: create draft canvas node for atomic create flow."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_create_atomic_node(*, nest: Any) -> Callable:
    async def create_atomic_node(state: dict) -> dict:
        spec = state.get("atomic_spec") or {}
        target_type = str(spec.get("target_type") or "image")
        prompt = str(spec.get("prompt") or "").strip()
        title = str(spec.get("title") or prompt[:24] or target_type)
        key = f"atomic_{target_type}"

        add_fn = getattr(nest, "add_nodes_batch", None)
        if add_fn is None:
            return {
                "phase": "error",
                "messages": [AIMessage(content="无法创建画布节点。")],
            }
        try:
            batch = await add_fn(
                [{"key": key, "title": title, "targetType": target_type, "prompt": prompt}],
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=f"创建节点失败：{exc}")],
            }

        nodes = batch.get("nodes") if isinstance(batch, dict) else None
        node_id = None
        if isinstance(nodes, list) and nodes:
            node_id = str(nodes[0].get("nodeId") or "").strip() or None
        if not node_id:
            return {
                "phase": "error",
                "messages": [AIMessage(content="创建节点失败：未返回 nodeId。")],
            }

        return {
            "phase": "atomic_create",
            "atomic_node_id": node_id,
            "messages": [AIMessage(content=f"已创建 {target_type} 节点，准备生产。")],
        }

    return create_atomic_node
