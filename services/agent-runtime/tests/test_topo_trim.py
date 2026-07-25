from app.graph.topo_trim import dependency_closure, trim_manifest_items

_ITEMS = [
    {"key": "copy_main", "title": "主文案", "depends_on": []},
    {"key": "white_bg", "title": "白底图", "depends_on": []},
    {"key": "hero_main", "title": "主图", "depends_on": ["white_bg"]},
    {"key": "banner", "title": "Banner", "depends_on": []},
    {"key": "show_video", "title": "视频", "depends_on": ["hero_main"]},
]


def test_closure_pulls_upstream():
    assert dependency_closure(_ITEMS, {"hero_main"}) == {"hero_main", "white_bg"}
    assert dependency_closure(_ITEMS, {"show_video"}) == {
        "show_video",
        "hero_main",
        "white_bg",
    }


def test_trim_preserves_order_and_drops_unused():
    out = trim_manifest_items(_ITEMS, ["hero_main", "copy_main"])
    keys = [x["key"] for x in out]
    assert keys == ["copy_main", "white_bg", "hero_main"]
    assert "banner" not in keys
