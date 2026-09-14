"""V1 gate: multi-turn export follow-up sees prior tool + export stays in core plan."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.graph.nodes.explore import make_explore_node
from app.tools.tool_plan import build_tool_plan


def test_v1_export_in_core_plan():
    assert "export_media_package" in build_tool_plan(loaded=[]).visible_names


@pytest.mark.asyncio
async def test_explore_llm_sees_prior_export_tool_name():
    """D7: canvas_agent must seed compressed history, not latest Human only."""
    captured: list = []

    llm = MagicMock()
    llm.bind_tools = MagicMock(side_effect=lambda tools: llm)

    async def _capture(convo):
        captured.append(list(convo))
        return AIMessage(content="好的，再次导出。")

    llm.ainvoke = AsyncMock(side_effect=_capture)

    nest = MagicMock()
    nest.get_canvas_summary = AsyncMock(return_value={"nodes": []})

    import app.graph.nodes.explore as explore_mod

    original = explore_mod.build_explore_tools
    explore_mod.build_explore_tools = lambda _nest: []
    try:
        explore = make_explore_node(llm=llm, nest=nest)
        await explore(
            {
                "messages": [
                    HumanMessage(content="打包导出全部"),
                    AIMessage(
                        content="已导出",
                        tool_calls=[
                            {
                                "name": "export_media_package",
                                "args": {},
                                "id": "1",
                            }
                        ],
                    ),
                    ToolMessage(content='{"ok": true}', tool_call_id="1"),
                    HumanMessage(content="再导一次，这次也是全部导出。"),
                ],
            }
        )
    finally:
        explore_mod.build_explore_tools = original

    assert captured, "expected explore to invoke LLM"
    flat = "\n".join(str(getattr(m, "content", "") or "") for m in captured[0])
    assert "export_media_package" in flat
    assert "再导一次" in flat
