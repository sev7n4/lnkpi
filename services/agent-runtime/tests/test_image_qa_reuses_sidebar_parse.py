"""product_visual image QA reuses sidebar parse cache instead of a second vision HTTP."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.graph.nodes.image_qa_gate import _run_qa_check

SKILLS = Path(__file__).resolve().parents[1] / "skills"
URL = "https://cdn.example/cup.jpg"

COMPLETE_QA = {
    "product_summary": "不锈钢水杯",
    "is_white_bg": True,
    "is_sharp_enough": True,
    "product_identifiable": True,
}

PARSE_COMPLETE = {
    "vision_used": True,
    "user_facing_summary": "不锈钢水杯",
    "fields": {"category": "水杯"},
    "image_urls": [URL],
    "qa": dict(COMPLETE_QA),
}


class FakeNest:
    def __init__(self) -> None:
        self.calls = 0

    async def run_vision_qa(self, **kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        return {
            "pass": True,
            "reason": "ok",
            "visionUsed": True,
            "productSummary": "from-http",
            "isWhiteBg": True,
            "isSharpEnough": True,
            "productIdentifiable": True,
        }


def _state(*, parse: dict, cache: dict | None = None) -> dict:
    return {
        "product_visual_scheme_v2": True,
        "sidebar_attachments": [{"mediaType": "image", "url": URL}],
        "sidebar_media_parse": parse,
        "sidebar_media_parse_cache": cache
        if cache is not None
        else {URL: {"vision_used": True, "qa": dict(parse.get("qa") or {})}},
    }


@pytest.mark.asyncio
async def test_image_qa_skips_vision_http_when_cache_covers_complete_qa():
    nest = FakeNest()
    out = await _run_qa_check(
        _state(parse=PARSE_COMPLETE),
        nest=nest,
        skills_dir=SKILLS,
        vision_creds=None,
    )
    assert nest.calls == 0
    assert out["product_summary"] == "不锈钢水杯"


@pytest.mark.asyncio
async def test_image_qa_reruns_vision_when_is_white_bg_missing():
    nest = FakeNest()
    parse = {
        **PARSE_COMPLETE,
        "qa": {
            "product_summary": "不锈钢水杯",
            "is_sharp_enough": True,
            "product_identifiable": True,
        },
    }
    out = await _run_qa_check(
        _state(parse=parse),
        nest=nest,
        skills_dir=SKILLS,
        vision_creds=None,
    )
    assert nest.calls == 1
    assert out.get("product_summary") == "from-http"
