"""T9: style3 ref-backed atomic create prompt + refs integration."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.atomic_create_node import make_create_atomic_node
from app.graph.nodes.atomic_parse import make_parse_atomic_intent_node

STYLE3 = "@T1 请按风格3出图"


class FakeNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def add_nodes_batch(self, items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add_nodes_batch", items))
        return {
            "nodes": [
                {"key": item["key"], "nodeId": f"node-{idx + 1}"}
                for idx, item in enumerate(items)
            ],
        }

    async def apply_sidebar_attachments(
        self,
        *,
        node_ids: list[str],
        attachments: list[dict],
        ref_order: list[str] | None,
        mode: str,
        mentioned_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            (
                "apply_sidebar_attachments",
                {
                    "node_ids": node_ids,
                    "attachments": attachments,
                    "ref_order": ref_order,
                    "mode": mode,
                    "mentioned_keys": mentioned_keys,
                },
            )
        )
        return {"applied": len(node_ids)}


@pytest.mark.asyncio
async def test_atomic_create_style3_prompt_and_refs():
    nest = FakeNest()
    parse = make_parse_atomic_intent_node(nest=nest, llm=None)
    parsed = await parse(
        {
            "messages": [HumanMessage(content=STYLE3)],
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text", "content": "风格3说明"}],
            "route_context": {"utterance": STYLE3, "mentioned_keys": ["T1"]},
            "route_decision": {"flow_mode": "atomic_create", "reason": "sidebar_ref_atomic"},
        }
    )
    spec = parsed.get("atomic_spec") or {}
    assert "按风格3" in str(spec.get("prompt") or "")

    create = make_create_atomic_node(nest=nest)
    await create(
        {
            **parsed,
            "sidebar_mentioned_keys": ["T1"],
            "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
        }
    )
    batch_calls = [c for c in nest.calls if c[0] == "add_nodes_batch"]
    assert batch_calls
    assert "按风格3" in batch_calls[0][1][0]["prompt"]
