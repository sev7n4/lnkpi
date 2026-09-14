from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.graph.recent_turns import compress_recent_turns


def test_compress_includes_prior_tool_name():
    msgs = [
        HumanMessage(content="打包导出全部"),
        AIMessage(
            content="已导出",
            tool_calls=[{"name": "export_media_package", "args": {}, "id": "1"}],
        ),
        ToolMessage(content='{"ok": true}', tool_call_id="1"),
        HumanMessage(content="再导一次，这次也是全部导出。"),
    ]
    text = compress_recent_turns(msgs)
    assert "export_media_package" in text
