"""Vision QA integration tests (spec P1-VQA-*)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from app.graph.nodes.image_qa_gate import (
    classify_image_qa_decision,
    make_image_qa_check_node,
    make_image_qa_remedy_node,
)
from app.graph.product_visual_v2.vision_qa import VisionQAResult, evaluate_vision_qa_v2
from app.graph.product_visual_v2.vision_qa_client import run_vision_qa

SKILLS = Path(__file__).resolve().parents[1] / "skills"

VISION_CREDS = {
    "provider_ref": "platform::gpt-4o",
    "model": "gpt-4o",
    "api_key": "sk-platform",
    "base_url": "https://api.openai.com/v1",
    "source": "platform",
}


class FakeNestVision:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[dict[str, Any]] = []

    async def run_vision_qa(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return self.payload


def _assert_provider_context(call: dict[str, Any], creds: dict[str, str]) -> None:
    assert call["provider_ref"] == creds["provider_ref"]
    assert call["model"] == creds["model"]
    assert call["api_key"] == creds["api_key"]
    assert call["base_url"] == creds["base_url"]
    assert call["source"] == creds["source"]


@pytest.mark.asyncio
async def test_vision_qa_check_pass_with_product_ref():
    nest = FakeNestVision(
        {
            "pass": True,
            "reason": "大闸蟹礼盒清晰，纯白背景，SKU 可辨",
            "visionUsed": True,
            "isWhiteBg": True,
            "isSharpEnough": True,
            "productIdentifiable": True,
        }
    )
    node = make_image_qa_check_node(nest=nest, skills_dir=SKILLS, vision_creds=VISION_CREDS)
    out = await node(
        {
            "product_visual_scheme_v2": True,
            "sidebar_attachments": [
                {
                    "id": "a1",
                    "mediaType": "image",
                    "sourceKind": "upload",
                    "label": "产品图",
                    "url": "https://cdn.example/crab.jpg",
                    "role": "product",
                }
            ],
            "messages": [HumanMessage(content="中秋大闸蟹包装")],
        }
    )
    assert out["image_qa_result"] == "pass"
    assert out.get("vision_used") is True
    assert "大闸蟹" in str(out.get("image_qa_reason") or "")
    assert nest.calls
    assert nest.calls[0]["image_urls"] == ["https://cdn.example/crab.jpg"]
    _assert_provider_context(nest.calls[0], VISION_CREDS)


@pytest.mark.asyncio
async def test_vision_qa_check_fail_shows_product_understanding():
    nest = FakeNestVision(
        {
            "pass": False,
            "reason": "背景杂乱，非白底",
            "visionUsed": True,
            "productSummary": "红色礼盒包装，可见品牌 logo，节日风格",
            "isWhiteBg": False,
            "isSharpEnough": True,
            "productIdentifiable": True,
        }
    )
    node = make_image_qa_check_node(nest=nest, skills_dir=SKILLS, vision_creds=VISION_CREDS)
    out = await node(
        {
            "product_visual_scheme_v2": True,
            "sidebar_attachments": [
                {
                    "id": "a1",
                    "mediaType": "image",
                    "sourceKind": "upload",
                    "label": "产品图",
                    "url": "https://cdn.example/gift.jpg",
                    "role": "product",
                }
            ],
        }
    )
    pres = out.get("presentation")
    assert isinstance(pres, dict)
    body = pres.get("body") or {}
    assert "礼盒" in str(body.get("understanding") or "")
    _assert_provider_context(nest.calls[0], VISION_CREDS)


@pytest.mark.asyncio
async def test_vision_qa_check_fail_shows_reason():
    nest = FakeNestVision(
        {
            "pass": False,
            "reason": "主体模糊，难以识别 SKU",
            "visionUsed": True,
            "isWhiteBg": True,
            "isSharpEnough": False,
            "productIdentifiable": False,
        }
    )
    node = make_image_qa_check_node(nest=nest, skills_dir=SKILLS, vision_creds=VISION_CREDS)
    out = await node(
        {
            "product_visual_scheme_v2": True,
            "sidebar_attachments": [
                {
                    "id": "a1",
                    "mediaType": "image",
                    "sourceKind": "upload",
                    "label": "产品图",
                    "url": "https://cdn.example/blur.jpg",
                    "role": "product",
                }
            ],
        }
    )
    assert out["image_qa_result"] == "fail"
    assert out["phase"] == "await_image_qa"
    assert "模糊" in str(out.get("image_qa_reason") or "")
    pres = out.get("presentation")
    assert isinstance(pres, dict)
    assert pres.get("title") == "产品图需要处理"
    checks = (pres.get("body") or {}).get("checks") or []
    assert any(
        ("清晰度" in c or "难以识别" in c)
        if isinstance(c, str)
        else ("清晰度" in c.get("label", "") or c.get("label") == "产品可辨")
        for c in checks
    )
    msgs = out.get("messages") or []
    assert msgs
    assert pres.get("title") in str(getattr(msgs[0], "content", ""))
    _assert_provider_context(nest.calls[0], VISION_CREDS)


@pytest.mark.asyncio
async def test_run_vision_qa_forwards_provider_context_without_settings_fallback(monkeypatch):
    nest = FakeNestVision(
        {
            "pass": True,
            "reason": "ok",
            "visionUsed": True,
            "isWhiteBg": True,
            "isSharpEnough": True,
            "productIdentifiable": True,
        }
    )
    # Even if settings have openai_* values, Context must come only from vision_creds.
    monkeypatch.setattr("app.config.settings.openai_chat_model", "should-not-use")
    monkeypatch.setattr("app.config.settings.openai_api_key", "sk-settings-should-not-use")
    monkeypatch.setattr("app.config.settings.openai_base_url", "https://settings.example/v1")

    out = await run_vision_qa(
        nest=nest,
        state={
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://cdn.example/crab.jpg", "role": "product"}
            ],
            "messages": [HumanMessage(content="中秋大闸蟹包装")],
        },
        skills_dir=SKILLS,
        vision_creds=VISION_CREDS,
    )
    assert out.pass_ is True
    assert nest.calls
    _assert_provider_context(nest.calls[0], VISION_CREDS)
    assert nest.calls[0]["model"] != "should-not-use"


@pytest.mark.asyncio
async def test_run_vision_qa_incomplete_creds_fail_without_settings(monkeypatch):
    monkeypatch.setattr("app.config.settings.openai_chat_model", "gpt-4o")
    monkeypatch.setattr("app.config.settings.openai_api_key", "sk-settings")
    monkeypatch.setattr("app.config.settings.openai_base_url", "https://api.openai.com/v1")

    out = await run_vision_qa(
        nest=None,
        state={
            "sidebar_attachments": [
                {"mediaType": "image", "url": "https://cdn.example/crab.jpg", "role": "product"}
            ],
        },
        skills_dir=SKILLS,
        vision_creds={"provider_ref": None, "model": None, "api_key": None, "base_url": None, "source": None},
    )
    assert out.pass_ is False
    assert out.vision_used is False
    assert "凭证不完整" in out.reason


def test_heuristic_only_cannot_pass_v2():
    out = evaluate_vision_qa_v2(
        VisionQAResult(pass_=True, reason="x", vision_used=False),
        {"has_white_bg": True, "sharpness": 0.9},
    )
    assert out["image_qa_result"] == "fail"


def test_classify_confirm_pass():
    assert classify_image_qa_decision("已是白底图，继续使用") == "confirm_pass"


@pytest.mark.asyncio
async def test_confirm_pass_remedy_skips_seed_gen():
    remedy = make_image_qa_remedy_node(nest=FakeNestVision({}))
    out = await remedy(
        {
            "image_qa_decision": "confirm_pass",
            "product_visual_scheme_v2": True,
        }
    )
    assert out["image_qa_result"] == "pass"
    assert out["phase"] == "dialog_draft"
