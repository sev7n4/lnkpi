"""P4: parse user utterance → atomic_spec."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_parse_util import (
    build_atomic_items_enriched,
    build_atomic_spec_enriched,
)


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_parse_atomic_intent_node(*, nest: Any | None = None) -> Callable:
    async def parse_atomic_intent(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        if not text.strip():
            return {
                "phase": "error",
                "last_error": "empty utterance",
                "messages": [AIMessage(content="请描述要生成的内容（如图、文案、视频等）。")],
            }

        canvas_summary = None
        if nest is not None:
            summary_fn = getattr(nest, "get_canvas_summary", None)
            if summary_fn is not None:
                try:
                    canvas_summary = await summary_fn()
                except Exception:  # noqa: BLE001 — parse fallback without canvas
                    canvas_summary = None

        spec = build_atomic_spec_enriched(
            text,
            canvas_summary=canvas_summary,
            focus_node_id=state.get("focus_node_id"),
        )
        multi_items = build_atomic_items_enriched(
            text,
            canvas_summary=canvas_summary,
            focus_node_id=state.get("focus_node_id"),
        )
        if multi_items:
            titles = "、".join(str(i.get("title") or "") for i in multi_items)
            ctx = spec.get("canvas_context")
            ctx_note = f" [{ctx}]" if ctx else ""
            return {
                "phase": "atomic_parse",
                "flow_mode": "atomic_create",
                "atomic_spec": multi_items[0],
                "atomic_items": multi_items,
                "messages": [
                    AIMessage(
                        content=f"原子创作：{len(multi_items)} 张 image 节点 — {titles}{ctx_note}",
                    ),
                ],
            }

        target = spec["target_type"]
        gate = "需确认" if spec["confirm_gate"] else "直达"
        ctx = spec.get("canvas_context")
        ctx_note = f" [{ctx}]" if ctx else ""
        return {
            "phase": "atomic_parse",
            "flow_mode": "atomic_create",
            "atomic_spec": spec,
            "messages": [
                AIMessage(content=f"原子创作：{target} 节点（{gate}）— {spec['title']}{ctx_note}"),
            ],
        }

    return parse_atomic_intent
