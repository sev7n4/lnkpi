from app.graph.sidebar_attachments import normalize_sidebar_attachments


def test_normalize_accepts_image():
    out = normalize_sidebar_attachments(
        [
            {
                "id": "a1",
                "mediaType": "image",
                "sourceKind": "upload",
                "label": "p.jpg",
                "url": "https://x/a.jpg",
            }
        ]
    )
    assert len(out) == 1
    assert out[0]["url"] == "https://x/a.jpg"


def test_normalize_accepts_text():
    out = normalize_sidebar_attachments(
        [
            {
                "id": "t1",
                "mediaType": "text",
                "sourceKind": "upload",
                "label": "brief",
                "text": "产品卖点",
            }
        ]
    )
    assert len(out) == 1
    assert out[0]["text"] == "产品卖点"


def test_normalize_rejects_blob():
    try:
        normalize_sidebar_attachments(
            [
                {
                    "id": "a1",
                    "mediaType": "image",
                    "sourceKind": "upload",
                    "label": "x",
                    "url": "blob:http://localhost/x",
                }
            ]
        )
        assert False, "expected error"
    except ValueError as e:
        assert "blob" in str(e).lower()


def test_normalize_rejects_empty():
    try:
        normalize_sidebar_attachments(
            [
                {
                    "id": "a1",
                    "mediaType": "image",
                    "sourceKind": "upload",
                    "label": "x",
                }
            ]
        )
        assert False, "expected error"
    except ValueError as e:
        assert "url" in str(e) or "text" in str(e)


def test_normalize_rejects_more_than_five():
    items = [
        {
            "id": f"a{i}",
            "mediaType": "text",
            "sourceKind": "upload",
            "label": f"t{i}",
            "text": f"line {i}",
        }
        for i in range(6)
    ]
    try:
        normalize_sidebar_attachments(items)
        assert False, "expected error"
    except ValueError as e:
        assert "5" in str(e)


def test_normalize_empty_returns_empty():
    assert normalize_sidebar_attachments(None) == []
    assert normalize_sidebar_attachments([]) == []


def test_normalize_mentioned_keys():
    from app.graph.sidebar_attachments import normalize_mentioned_keys

    assert normalize_mentioned_keys(["i1", "I1", "T2"]) == ["I1", "T2"]
    assert normalize_mentioned_keys(None) == []


def test_parse_mentioned_keys_from_text():
    from app.graph.sidebar_attachments import parse_mentioned_keys_from_text

    assert parse_mentioned_keys_from_text("按 @I1 风格，@T2 文案") == ["I1", "T2"]
    assert parse_mentioned_keys_from_text("无提及") == []
