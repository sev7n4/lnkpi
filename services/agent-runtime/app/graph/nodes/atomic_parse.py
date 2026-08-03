"""P4: parse user utterance → atomic_spec."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_intent import build_atomic_spec


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def make_parse_atomic_intent_node() -> Callable:
    async def parse_atomic_intent(state: dict) -> dict:
        text = _latest_user_text(state.get("messages") or [])
        if not text.strip():
            return {
                "phase": "error",
                "last_error": "empty utterance",
                "messages": [AIMessage(content="请描述要生成的内容（如图、文案、视频等）。")],
            }
        spec = build_atomic_spec(text)
        target = spec["target_type"]
        gate = "需确认" if spec["confirm_gate"] else "直达"
        return {
            "phase": "atomic_parse",
            "flow_mode": "atomic_create",
            "atomic_spec": spec,
            "messages": [
                AIMessage(content=f"原子创作：{target} 节点（{gate}）— {spec['title']}"),
            ],
        }

    return parse_atomic_intent
