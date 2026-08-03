"""Tests for Phase C canvas → manifest reconciliation."""

from __future__ import annotations

from app.graph.canvas_sync import reconcile_manifest_from_canvas


def test_reconcile_drops_removed_canvas_nodes():
    manifest = [
        {"key": "hero_main", "title": "主图", "node_id": "img-1", "target_type": "image"},
        {"key": "banner", "title": "Banner", "node_id": "img-2", "target_type": "image"},
    ]
    canvas = [{"id": "img-1", "type": "image", "title": "主图", "status": "idle"}]
    updated, note = reconcile_manifest_from_canvas(manifest, canvas)
    keys = {str(it["key"]) for it in updated}
    assert keys == {"hero_main"}
    assert "移除" in note


def test_reconcile_adds_new_canvas_image_nodes():
    manifest = [{"key": "hero_main", "title": "主图", "node_id": "img-1", "target_type": "image"}]
    canvas = [
        {"id": "img-1", "type": "image", "title": "主图", "status": "idle"},
        {"id": "img-new", "type": "image", "title": "场景图", "status": "idle"},
    ]
    updated, note = reconcile_manifest_from_canvas(manifest, canvas, plan_node_id="plan-1")
    keys = {str(it["key"]) for it in updated}
    assert len(keys) == 2
    assert any(it.get("node_id") == "img-new" for it in updated)
    assert "纳入" in note


def test_reconcile_skips_plan_node():
    manifest = [{"key": "hero_main", "title": "主图", "node_id": "img-1", "target_type": "image"}]
    canvas = [
        {"id": "plan-1", "type": "text", "title": "营销方案", "status": "idle"},
        {"id": "img-1", "type": "image", "title": "主图", "status": "idle"},
    ]
    updated, _ = reconcile_manifest_from_canvas(manifest, canvas, plan_node_id="plan-1")
    assert len(updated) == 1
