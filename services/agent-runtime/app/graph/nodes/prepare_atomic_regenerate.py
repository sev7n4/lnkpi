"""L1-03: re-run atomic gen on existing canvas node (skip parse/create)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_prepare_atomic_regenerate_node(*, nest: Any) -> Callable:
    async def prepare_atomic_regenerate(state: dict) -> dict:
        node_id = str(state.get("atomic_node_id") or "").strip()
        spec = state.get("atomic_spec") or {}
        title = str(spec.get("title") or spec.get("target_type") or "节点")

        if not node_id:
            return {
                "phase": "error",
                "last_error": "missing atomic_node_id",
                "messages": [AIMessage(content="没有可重新生成的节点，请先描述要创作的内容。")],
            }

        get_node = getattr(nest, "get_node", None)
        if get_node is not None:
            try:
                node = await get_node(node_id)
                if not isinstance(node, dict) or not str(node.get("id") or node_id).strip():
                    return {
                        "phase": "error",
                        "last_error": "atomic node missing",
                        "messages": [AIMessage(content="画布节点已不存在，请重新描述要生成的内容。")],
                    }
            except Exception as exc:  # noqa: BLE001
                return {
                    "phase": "error",
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"读取节点失败：{exc}")],
                }

        return {
            "phase": "atomic_create",
            "flow_mode": "atomic_regenerate",
            "last_error": None,
            "atomic_record_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=f"正在重新生成「{title}」…")],
        }

    return prepare_atomic_regenerate
