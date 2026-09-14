from app.graph.builder import build_agent_graph


class _Nest:
    async def close(self):
        pass


class _Llm:
    async def ainvoke(self, messages):
        class R:
            content = "ok"

        return R()


def test_start_edges_include_parse_node():
    g = build_agent_graph(nest=_Nest(), llm=_Llm(), skills_dir=".")
    names = set(g.get_graph().nodes)
    assert "parse_sidebar_media" in names
