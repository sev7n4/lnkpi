import pytest

from app.graph.builder import route_entry
from app.graph.nodes.done import make_done_node


def test_route_entry_prefers_copy_gate():
    assert (
        route_entry(
            {
                "awaiting_user": True,
                "phase": "await_copy_confirm",
            }
        )
        == "await_copy_confirm"
    )


def test_route_entry_still_supports_plan_confirm():
    assert (
        route_entry(
            {
                "awaiting_user": True,
                "phase": "await_confirm",
            }
        )
        == "await_confirm"
    )


@pytest.mark.asyncio
async def test_done_preserves_copy_gate():
    done = make_done_node()
    out = await done(
        {
            "awaiting_user": True,
            "phase": "await_copy_confirm",
            "copy_draft": "主文案草稿",
            "gen_completed": ["n1"],
            "gen_failed": [],
        }
    )
    assert out["awaiting_user"] is True
    assert out["phase"] == "await_copy_confirm"


@pytest.mark.asyncio
async def test_done_pending_orchestrate_copy_ready_tip():
    done = make_done_node()
    out = await done(
        {
            "awaiting_user": True,
            "phase": "await_copy_confirm",
            "copy_draft": "主文案草稿",
            "pending_orchestrate": True,
            "gen_completed": [],
            "gen_failed": [],
        }
    )
    assert out["phase"] == "await_copy_confirm"
    assert out["pending_orchestrate"] is False
    assert "后台生成" in out["messages"][0].content
