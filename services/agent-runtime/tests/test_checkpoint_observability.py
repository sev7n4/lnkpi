"""Tests for checkpoint observability helpers."""

from app.checkpoint_observability import checkpoint_diagnostics, has_atomic_checkpoint


def test_has_atomic_checkpoint_true():
    assert has_atomic_checkpoint(
        {
            "atomic_node_id": "node-1",
            "atomic_spec": {"target_type": "image", "title": "主图"},
        }
    )


def test_checkpoint_diagnostics_exposes_has_flag():
    diag = checkpoint_diagnostics({"atomic_node_id": "n1", "atomic_spec": {"target_type": "text"}})
    assert diag["hasAtomicCheckpoint"] is True
    assert diag["atomicNodeId"] == "n1"
