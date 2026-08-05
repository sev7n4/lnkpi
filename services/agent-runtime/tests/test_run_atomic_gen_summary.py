"""Tests for run_atomic_gen completion summary."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from app.graph.nodes.run_atomic_gen import make_run_atomic_gen_node


class PromptNest:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def run_prompt_generation(self, node_id: str) -> dict:
        self.calls.append(("run_prompt_generation", node_id))
        return {
            "status": "completed",
            "generationRecordId": "rec-prompt-1",
            "completionSummary": "已生成 8 镜商业分镜表（含策略层与校验锁），双击节点可查看完整表格。",
        }


@pytest.mark.asyncio
async def test_prompt_completion_summary_appended_to_chat_message():
    nest = PromptNest()
    run = make_run_atomic_gen_node(nest=nest)
    out = await run(
        {
            "atomic_node_id": "prompt-1",
            "atomic_spec": {
                "target_type": "prompt",
                "title": "问界M9 30秒商业分镜提示词",
                "prompt": "问界M9 30秒商业分镜提示词",
            },
        }
    )
    assert out["phase"] == "done"
    msg = out["messages"][0]
    assert isinstance(msg, AIMessage)
    assert "8 镜商业分镜表" in msg.content
    assert "record:" not in msg.content
