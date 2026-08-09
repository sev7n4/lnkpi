"""CI contract: 28 explore demo utterances → intent + mandatory dispatch."""

from __future__ import annotations

import pytest

from app.errors import AgentToolError
from app.graph.explore_contract_cases import EXPLORE_CONTRACT_CASES, SUMMARY, ExploreContractCase
from app.graph.explore_dispatch import classify_explore_intent, run_mandatory_explore


class FakeTool:
    def __init__(self, name: str, *, result: dict | None = None) -> None:
        self.name = name
        self.result = result or {"ok": True}
        self.calls: list[dict] = []

    async def ainvoke(self, args: dict) -> dict:
        self.calls.append(args)
        if "canvasCommands" not in self.result and self.name in {
            "undo",
            "redo",
            "focus_node",
            "focus_nodes",
            "open_image_editor",
            "introduce_nodes_to_agent",
        }:
            cmd_type = "introduce_nodes" if self.name == "introduce_nodes_to_agent" else self.name
            return {**self.result, "canvasCommands": [{"type": cmd_type}]}
        return self.result


def _mandatory_cases() -> list[ExploreContractCase]:
    return [c for c in EXPLORE_CONTRACT_CASES if c.mandatory_tool]


@pytest.mark.parametrize("case", EXPLORE_CONTRACT_CASES, ids=lambda c: c.tool)
def test_intent_classification(case: ExploreContractCase) -> None:
    assert classify_explore_intent(case.message, summary=SUMMARY) == case.expected_intent


@pytest.mark.parametrize("case", _mandatory_cases(), ids=lambda c: c.tool)
@pytest.mark.asyncio
async def test_mandatory_dispatch_calls_expected_tool(case: ExploreContractCase) -> None:
    assert case.mandatory_tool
    tool = FakeTool(case.mandatory_tool)
    tools = {case.mandatory_tool: tool}
    out = await run_mandatory_explore(
        case.expected_intent,
        case.message,
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == [case.mandatory_tool], out.reply_text
    if case.expect_canvas_cmd:
        assert out.canvas_commands
        assert out.canvas_commands[0]["type"] == case.expect_canvas_cmd


@pytest.mark.asyncio
async def test_mandatory_lifecycle_graceful_nest_param_error() -> None:
    class FailTool:
        async def ainvoke(self, args: dict) -> dict:
            raise AgentToolError(
                {
                    "error_type": "param_error",
                    "tool_name": "cancelGeneration",
                    "message": "请求参数有误",
                    "retry_hint": "请检查参数后重试",
                }
            )

    tools = {"cancel_generation": FailTool()}
    out = await run_mandatory_explore(
        "lifecycle",
        "查询并取消 image-16 节点上正在进行的生成任务",
        summary=SUMMARY,
        tools_by_name=tools,
    )
    assert out.tools_called == ["cancel_generation"]
    assert "无进行中" in out.reply_text
