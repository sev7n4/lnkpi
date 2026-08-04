"""Tests for checkpoint observability helpers."""

from app.checkpoint_observability import checkpoint_diagnostics, has_atomic_checkpoint


def test_has_atomic_checkpoint_false_when_empty():
    assert not has_atomic_checkpoint({})
    assert not has_atomic_checkpoint({"atomic_node_id": "n1"})


def test_has_atomic_checkpoint_true():
    assert has_atomic_checkpoint(
        {
            "atomic_node_id": "node-1",
            "atomic_spec": {"target_type": "image", "title": "主图"},
        }
    )


def test_checkpoint_diagnostics_shape():
    diag = checkpoint_diagnostics(
        {
            "atomic_node_id": "node-abc",
            "atomic_spec": {"target_type": "image", "title": "模特人物图"},
            "flow_mode": "atomic_create",
            "phase": "done",
        }
    )
    assert diag["hasAtomicCheckpoint"] is True
    assert diag["atomicNodeId"] == "node-abc"
    assert diag["atomicTargetType"] == "image"
    assert diag["atomicTitle"] == "模特人物图"
    assert diag["flowMode"] == "atomic_create"
    assert diag["phase"] == "done"
