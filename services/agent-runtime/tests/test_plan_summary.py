"""Unit tests for readable plan confirm summary."""

from __future__ import annotations

from app.graph.nodes.plan import build_confirm_message


def test_build_confirm_message_lists_assets_and_n():
    skill_manifest = {
        "items": [
            {"key": "white_bg", "title": "白底图"},
            {"key": "hero_main", "title": "主图"},
            {"key": "scene", "title": "场景图"},
        ]
    }
    msg = build_confirm_message(
        plan_md="# 定位\n口袋里的澎湃声场\n\n## 其它\n很长…",
        canvas_manifest=skill_manifest,
    )
    assert "白底图" in msg
    assert "主图" in msg
    assert "场景图" in msg
    assert "将拆解 3" in msg or "拆解 3" in msg
    assert "营销方案" in msg
    assert "请确认是否按此方案拆解画布并出图" in msg
