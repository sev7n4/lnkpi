"""T6: clarify_route writes route_orchestration checkpoint."""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.clarify_route import make_clarify_route_node


@pytest.mark.asyncio
async def test_clarify_route_writes_route_orchestration_checkpoint():
    node = make_clarify_route_node()
    out = await node(
        {
            "clarify_question": "回复 1 / 2 / 3",
            "route_clarify": True,
            "route_context": {
                "utterance": "@T1 请按风格3出图",
                "mentioned_keys": ["T1"],
            },
            "sidebar_mentioned_keys": ["T1"],
        }
    )
    ctx = out.get("clarify_context")
    assert isinstance(ctx, dict)
    assert ctx.get("kind") == "route_orchestration"
    assert ctx.get("original_utterance") == "@T1 请按风格3出图"
    assert ctx.get("mentioned_keys") == ["T1"]
    assert out.get("phase") == "clarify"
    assert out.get("flow_mode") != "chat"
    msg = out.get("messages") or []
    assert msg and "已看到引用 @T1" in str(msg[0].content)
