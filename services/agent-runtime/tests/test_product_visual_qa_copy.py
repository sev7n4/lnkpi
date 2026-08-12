"""UX-PV-01: vision QA user-friendly copy mapping."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.nodes.image_qa_gate import make_await_image_qa_node, make_image_qa_check_node
from app.graph.product_visual_v2.vision_qa import VisionQAResult, build_qa_checks


@pytest.fixture
def copy() -> ProductVisualCopy:
    return ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")


def test_format_error_maps_to_service_unavailable_not_technical(copy: ProductVisualCopy):
    out = copy.map_qa_failure(
        reason="识图模型返回格式异常",
        vision_used=False,
        metrics={"sharpness": 0.7, "has_white_bg": False},
    )
    assert "格式异常" not in out["title"]
    assert out["kind"] == "callout_info"
    assert any(o["id"] == "confirm_pass" for o in out["options"])
    assert out["options"][0]["label"] == "就用这张图，继续"


def test_quality_fail_uses_quality_body_not_service_unavailable(copy: ProductVisualCopy):
    out = copy.map_qa_failure(
        reason="图源未通过识图审核",
        vision_used=True,
        metrics={
            "sharpness": 0.3,
            "is_sharp_enough": False,
            "is_white_bg": False,
            "product_identifiable": True,
        },
    )
    assert out["kind"] == "callout_warn"
    assert out["title"] == "产品图需要处理"
    assert out["body"] != copy.get("qa.service_unavailable_body")
    assert "service_unavailable" not in out["body"]


def test_quality_fail_includes_checks(copy: ProductVisualCopy):
    metrics = {
        "is_sharp_enough": False,
        "is_white_bg": False,
        "product_identifiable": True,
    }
    checks = build_qa_checks(
        VisionQAResult(
            pass_=False,
            reason="模糊",
            vision_used=True,
            is_sharp_enough=False,
            is_white_bg=False,
            product_identifiable=True,
        ),
        metrics,
    )
    labels = [c["label"] for c in checks if isinstance(c, dict)]
    assert any("清晰度" in label for label in labels)
    assert any("白底" in label for label in labels)


def test_soft_pass_when_sharpness_ok_no_explicit_fail(copy: ProductVisualCopy):
    out = copy.map_qa_failure(
        reason="白底背景未确认",
        vision_used=False,
        metrics={"sharpness": 0.7, "has_white_bg": False},
    )
    assert out["kind"] == "callout_info"
    assert "格式异常" not in out["title"]


def test_build_qa_checks_human_readable():
    checks = build_qa_checks(
        VisionQAResult(
            pass_=False,
            reason="x",
            vision_used=True,
            is_sharp_enough=False,
            is_white_bg=True,
            product_identifiable=False,
        ),
        {},
    )
    assert checks[0]["ok"] is False
    assert checks[0]["label"] == "清晰度"


@pytest.mark.asyncio
async def test_image_qa_check_fail_sets_presentation_envelope():
    node = make_image_qa_check_node()
    out = await node(
        {
            "sidebar_attachments": [
                {"mediaType": "image", "role": "product", "sharpness": 0.1, "has_white_bg": False}
            ],
        }
    )
    assert out["image_qa_result"] == "fail"
    pres = out.get("presentation")
    assert isinstance(pres, dict)
    assert pres.get("kind") in ("callout_info", "callout_warn")
    assert pres.get("title")
    assert pres.get("options")
    msgs = out.get("messages") or []
    assert msgs
    content = msgs[0].content if isinstance(msgs[0], AIMessage) else str(msgs[0])
    assert "格式异常" not in content
    assert "识图模型" not in content or "暂时不可用" in (pres.get("title") or "")


@pytest.mark.asyncio
async def test_await_image_qa_invalid_reply_uses_friendly_copy():
    await_node = make_await_image_qa_node()
    out = await await_node(
        {
            "messages": [HumanMessage(content="随便说说")],
            "image_qa_reason": "识图模型返回格式异常",
            "vision_used": False,
            "image_qa_metrics": {"sharpness": 0.7},
        }
    )
    pres = out.get("presentation")
    assert isinstance(pres, dict)
    assert "格式异常" not in (pres.get("title") or "")
