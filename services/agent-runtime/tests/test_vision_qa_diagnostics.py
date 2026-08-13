"""Tests for vision QA diagnostic codes."""

from __future__ import annotations

from app.graph.product_visual_v2.vision_qa_diagnostics import (
    VISION_QA_CODE_MISSING_API_KEY,
    VISION_QA_CODE_MISSING_IMAGE,
    VISION_QA_CODE_MODEL_NOT_VISION,
    VISION_QA_CODE_PASS,
    VISION_QA_CODE_QUALITY_FAIL,
    VISION_QA_CODE_FORMAT_ERROR,
    classify_vision_qa_failure_code,
    vision_qa_code_label,
)


def test_classify_missing_image():
    code = classify_vision_qa_failure_code(
        reason="未检测到产品参考图，请上传图片后重试",
        vision_used=False,
    )
    assert code == VISION_QA_CODE_MISSING_IMAGE


def test_classify_missing_api_key():
    code = classify_vision_qa_failure_code(
        reason="未配置识图模型 API Key，无法完成图源审核",
        vision_used=False,
    )
    assert code == VISION_QA_CODE_MISSING_API_KEY


def test_classify_model_not_vision():
    code = classify_vision_qa_failure_code(
        reason="当前文本模型（deepseek-chat）不支持识图，请在 Agent 侧栏选择 Gemini / GPT-4o 等视觉模型",
        vision_used=False,
    )
    assert code == VISION_QA_CODE_MODEL_NOT_VISION


def test_classify_quality_fail():
    code = classify_vision_qa_failure_code(
        reason="产品图不够清晰",
        vision_used=True,
        metrics={"is_sharp_enough": False},
    )
    assert code == VISION_QA_CODE_QUALITY_FAIL


def test_classify_format_error():
    code = classify_vision_qa_failure_code(
        reason="识图模型返回格式异常，请重试或换一张更清晰的产品图",
        vision_used=True,
    )
    assert code == VISION_QA_CODE_FORMAT_ERROR


def test_classify_pass():
    assert (
        classify_vision_qa_failure_code(reason="ok", vision_used=True, pass_=True)
        == VISION_QA_CODE_PASS
    )


def test_code_label():
    assert "参考图" in vision_qa_code_label(VISION_QA_CODE_MISSING_IMAGE)
