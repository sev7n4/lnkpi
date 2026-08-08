from app.graph.canvas_commands import extract_canvas_commands


def test_extract_canvas_commands_from_harness_result():
    result = {
        "attachments": [],
        "canvasCommands": [{"type": "focus_node", "nodeId": "n1"}],
    }
    assert extract_canvas_commands(result) == [{"type": "focus_node", "nodeId": "n1"}]


def test_extract_ignores_invalid():
    assert extract_canvas_commands("x") == []
    assert extract_canvas_commands({"canvasCommands": [{"bad": 1}]}) == []
