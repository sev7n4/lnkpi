from app.graph.cancel_checkpoint import build_cancelled_checkpoint_update


def test_build_cancelled_checkpoint_update_shape():
    upd = build_cancelled_checkpoint_update(
        completed_tasks=2,
        total_tasks=5,
        reason="user",
        from_phase="orchestrate_gen",
    )
    assert upd["phase"] == "cancelled"
    assert upd["cancelled_from_phase"] == "orchestrate_gen"
    assert upd["run_cancelled"] is True
    assert upd["cancel_reason"] == "user"
    assert upd["presentation"]["kind"] == "callout_info"
    assert "2/5" in upd["presentation"]["body"]["text"]
    assert "发起新任务" in upd["presentation"]["body"]["text"]


def test_build_cancelled_checkpoint_update_without_origin_phase():
    assert build_cancelled_checkpoint_update()["cancelled_from_phase"] is None
    assert (
        build_cancelled_checkpoint_update(from_phase="   ")["cancelled_from_phase"] is None
    )


def test_build_cancelled_checkpoint_update_never_stores_cancelled_as_origin():
    """Re-cancelling must not overwrite the origin phase with the sentinel."""
    upd = build_cancelled_checkpoint_update(from_phase="cancelled")
    assert upd["cancelled_from_phase"] is None
