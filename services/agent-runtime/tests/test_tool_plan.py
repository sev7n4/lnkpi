from app.tools.tool_plan import build_tool_plan
from app.tools.tool_registry import (
    DEFERRED_TOOL_NAMES,
    TOOL_EXPOSURES,
    TOOL_PLACEMENTS,
    ToolExposure,
)


def test_i5_every_placement_has_exposure():
    assert set(TOOL_EXPOSURES) == set(TOOL_PLACEMENTS)


def test_i6_graph_only_never_visible():
    plan = build_tool_plan(loaded=[])
    for name, exp in TOOL_EXPOSURES.items():
        if exp == ToolExposure.GRAPH_ONLY:
            assert name not in plan.visible_names


def test_i7_deferred_in_catalog():
    plan = build_tool_plan(loaded=[])
    catalog_names = {c["name"] for c in plan.deferred_catalog}
    assert DEFERRED_TOOL_NAMES <= catalog_names
    assert DEFERRED_TOOL_NAMES.isdisjoint(plan.visible_names)


def test_loaded_deferred_enters_visible():
    name = next(iter(DEFERRED_TOOL_NAMES))
    plan = build_tool_plan(loaded=[name])
    assert name in plan.visible_names


def test_stable_order_is_sorted():
    plan = build_tool_plan(loaded=[])
    assert plan.ordered_visible == sorted(plan.ordered_visible)


def test_v6_gen_not_visible():
    plan = build_tool_plan(loaded=[])
    assert "run_image_generation" not in plan.visible_names
