from pathlib import Path

from app.tools.definitions import build_canvas_tools
from app.tools.tool_registry import (
    DEFERRED_GRAPH_NODE_TOOLS,
    EXPLORE_TOOL_NAMES,
    GRAPH_NODE_CALL_SITES,
    TOOL_PLACEMENTS,
    ToolPlacement,
)


class _Fake:
    pass


def test_i1_every_spec_has_placement():
    names = {t.name for t in build_canvas_tools(_Fake())}  # type: ignore[arg-type]
    missing = names - set(TOOL_PLACEMENTS)
    extra = set(TOOL_PLACEMENTS) - names
    # ui_command-only names may exist only in EXPLORE_TOOL_NAMES; allow TOOL_PLACEMENTS ⊇ specs
    assert not missing, f"specs missing placement: {sorted(missing)}"
    # placements without specs are ok only for documentation — prefer none
    assert not (extra - names), f"placements without specs: {sorted(extra - names)}"


def test_i2_explore_placement_matches_whitelist():
    # UI_COMMAND tools stay explore-bound today (I4); whitelist is EXPLORE ∪ UI_COMMAND.
    from_placement = {
        n
        for n, p in TOOL_PLACEMENTS.items()
        if p in (ToolPlacement.EXPLORE, ToolPlacement.UI_COMMAND)
    }
    assert from_placement == set(EXPLORE_TOOL_NAMES)


def test_i3_graph_node_has_call_site_or_deferred():
    graph_root = Path(__file__).resolve().parents[1] / "app" / "graph"
    corpus = "\n".join(p.read_text(encoding="utf-8") for p in graph_root.rglob("*.py"))
    graph_nodes = {
        n for n, p in TOOL_PLACEMENTS.items() if p == ToolPlacement.GRAPH_NODE
    }
    for name in sorted(graph_nodes):
        if name in DEFERRED_GRAPH_NODE_TOOLS:
            continue
        assert name in GRAPH_NODE_CALL_SITES or name in corpus, (
            f"graph_node tool {name!r} has no app/graph reference; "
            f"add call site or GRAPH_NODE_CALL_SITES / DEFERRED_GRAPH_NODE_TOOLS"
        )
        if name in GRAPH_NODE_CALL_SITES:
            assert name in corpus, f"{name} listed in CALL_SITES but not found under app/graph"


def test_i4_no_orphan_explore_mismatch():
    """Orphan = StructuredTool with no viable placement path."""
    specs = {t.name for t in build_canvas_tools(_Fake())}  # type: ignore[arg-type]
    for name in specs:
        assert name in TOOL_PLACEMENTS
        p = TOOL_PLACEMENTS[name]
        if p == ToolPlacement.EXPLORE:
            assert name in EXPLORE_TOOL_NAMES
        elif p == ToolPlacement.GRAPH_NODE:
            assert name not in EXPLORE_TOOL_NAMES or name in DEFERRED_GRAPH_NODE_TOOLS
            # reachable: call site, deferred, or CALL_SITES verified in I3
        elif p == ToolPlacement.UI_COMMAND:
            assert name in EXPLORE_TOOL_NAMES  # current product: ui cmds exposed via explore
