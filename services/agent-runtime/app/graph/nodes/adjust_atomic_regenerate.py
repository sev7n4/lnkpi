"""Phase 3 L1-04: regenerate with prompt adjustment before re-gen."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_context import build_atomic_parse_context
from app.graph.atomic_intent import apply_regenerate_adjust, detect_regenerate_adjust


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_adjust_atomic_regenerate_node(*, nest: Any) -> Callable:
    async def adjust_atomic_regenerate(state: dict) -> dict:
        node_id = str(state.get("atomic_node_id") or "").strip()
        spec = state.get("atomic_spec") or {}
        text = _latest_user_text(state.get("messages") or [])
        adjust = detect_regenerate_adjust(text)
        title = str(spec.get("title") or spec.get("target_type") or "节点")

        if not node_id:
            return {
                "phase": "error",
                "last_error": "missing atomic_node_id",
                "messages": [AIMessage(content="没有可重新生成的节点，请先描述要创作的内容。")],
            }

        canvas_summary = None
        get_summary = getattr(nest, "get_canvas_summary", None)
        if get_summary is not None:
            try:
                canvas_summary = await get_summary()
            except Exception:  # noqa: BLE001
                canvas_summary = None

        parse_ctx = build_atomic_parse_context(state, canvas_summary=canvas_summary)
        updated_spec = apply_regenerate_adjust(spec, adjust, parse_context=parse_ctx or None)

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

        detail = f"（{adjust}）" if adjust else ""
        return {
            "phase": "atomic_create",
            "flow_mode": "atomic_regenerate",
            "atomic_spec": updated_spec,
            "last_error": None,
            "atomic_record_id": None,
            "user_decision": "none",
            "messages": [AIMessage(content=f"正在按新要求重新生成「{title}」{detail}…")],
        }

    return adjust_atomic_regenerate
