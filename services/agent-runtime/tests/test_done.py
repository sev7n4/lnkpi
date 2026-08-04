import json

import pytest

from app.graph.nodes.done import make_done_node


class _NestWithProgress:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def get_gen_progress(self, thread_id: str) -> dict:
        return {
            "id": "gp-1",
            "lines": json.dumps(self._lines),
            "summary": None,
        }


@pytest.mark.asyncio
async def test_done_preserves_copy_gate():
    done = make_done_node()
    out = await done(
        {
            "phase": "await_copy_confirm",
            "copy_draft": "主文案草稿",
        }
    )
    assert out["phase"] == "await_copy_confirm"


@pytest.mark.asyncio
async def test_done_after_gen_reads_gen_progress():
    nest = _NestWithProgress(["· n1：出图成功"])
    done = make_done_node(nest=nest)
    out = await done(
        {
            "phase": "orchestrate_gen",
            "thread_id": "t1",
            "gen_progress_id": "gp-1",
        }
    )
    assert out["phase"] == "done"
    assert "成功 1" in out["messages"][0].content


@pytest.mark.asyncio
async def test_done_without_progress_uses_last_error():
    done = make_done_node()
    out = await done({"phase": "done", "last_error": "出图编排失败：cycle"})
    assert "出图编排失败" in out["messages"][0].content


@pytest.mark.asyncio
async def test_done_skips_campaign_fallback_for_atomic_flow():
    done = make_done_node()
    out = await done({"phase": "done", "flow_mode": "atomic_create"})
    assert out["phase"] == "done"
    assert out["messages"] == []
