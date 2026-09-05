from app.graph.cancel_checkpoint import build_cancelled_checkpoint_update


def test_build_cancelled_checkpoint_update_shape():
    upd = build_cancelled_checkpoint_update(completed_tasks=2, total_tasks=5, reason="user")
    assert upd["phase"] == "cancelled"
    assert upd["run_cancelled"] is True
    assert upd["cancel_reason"] == "user"
    assert upd["presentation"]["kind"] == "callout_info"
    assert "2/5" in upd["presentation"]["body"]["text"]
    assert "发起新任务" in upd["presentation"]["body"]["text"]
