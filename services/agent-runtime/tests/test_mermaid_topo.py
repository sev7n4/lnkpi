from app.graph.mermaid_topo import manifest_to_mermaid


def test_mermaid_includes_titles_and_edges():
    text = manifest_to_mermaid(
        [
            {"key": "white_bg", "title": "白底图", "depends_on": []},
            {"key": "hero_main", "title": "主图", "depends_on": ["white_bg"]},
            {"key": "copy_main", "title": "主文案", "depends_on": []},
        ]
    )
    assert "白底图" in text
    assert "主图" in text
    assert "white_bg" in text
    assert "-->" in text
    assert "flowchart LR" in text


def test_mermaid_empty():
    text = manifest_to_mermaid([])
    assert "暂无节点" in text
