import pytest

from app.graph.nodes.done import make_done_node


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
            "gen_completed": ["n1"],
            "gen_failed": [],
        }
    )
    assert out["phase"] == "done"
