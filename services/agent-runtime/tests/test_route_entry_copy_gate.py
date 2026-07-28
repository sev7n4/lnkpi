import pytest

from app.graph.builder import route_entry
from app.graph.nodes.done import make_done_node


def test_route_entry_returns_intake_by_default():
    # W5: route_entry 简化后默认返回 intake
    assert route_entry({"phase": "await_copy_confirm"}) == "intake"
    assert route_entry({"phase": "await_confirm"}) == "intake"
    assert route_entry({"phase": "await_topo", "messages": []}) == "intake"


def test_route_entry_returns_orchestrate_gen_when_pending():
    # pending_orchestrate=True 时直接进入 orchestrate_gen
    assert route_entry({"phase": "await_topo", "pending_orchestrate": True}) == "orchestrate_gen"


@pytest.mark.asyncio
async def test_done_preserves_copy_gate():
    done = make_done_node()
    out = await done(
        {
            "phase": "await_copy_confirm",
            "copy_draft": "主文案草稿",
            "gen_completed": ["n1"],
            "gen_failed": [],
        }
    )
    assert out["phase"] == "await_copy_confirm"


@pytest.mark.asyncio
async def test_done_after_gen_is_done():
    done = make_done_node()
    out = await done(
        {
            "phase": "orchestrate_gen",
            "copy_draft": "主文案草稿",
            "pending_orchestrate": False,
            "gen_completed": ["n1"],
            "gen_failed": [],
        }
    )
    assert out["phase"] == "done"
    assert out["pending_orchestrate"] is False
