"""Vision QA failure classification for ops diagnostics and SSE passthrough."""

from __future__ import annotations

from typing import Any

# Stable codes for logs, deploy scripts, and frontend diagnostics.
VISION_QA_CODE_PASS = "pass"
VISION_QA_CODE_MISSING_IMAGE = "missing_image"
VISION_QA_CODE_MISSING_API_KEY = "missing_api_key"
VISION_QA_CODE_MODEL_NOT_VISION = "model_not_vision"
VISION_QA_CODE_VISION_NOT_INVOKED = "vision_not_invoked"
VISION_QA_CODE_VISION_NOT_USED = "vision_not_used"
VISION_QA_CODE_FORMAT_ERROR = "vision_format_error"
VISION_QA_CODE_CALL_FAILED = "vision_call_failed"
VISION_QA_CODE_QUALITY_FAIL = "quality_fail"
VISION_QA_CODE_UNKNOWN = "unknown"

_VISION_QA_CODE_LABELS: dict[str, str] = {
    VISION_QA_CODE_PASS: "识图审核通过",
    VISION_QA_CODE_MISSING_IMAGE: "未检测到产品参考图",
    VISION_QA_CODE_MISSING_API_KEY: "未配置识图 API Key",
    VISION_QA_CODE_MODEL_NOT_VISION: "当前模型不支持识图",
    VISION_QA_CODE_VISION_NOT_INVOKED: "识图模型未调用",
    VISION_QA_CODE_VISION_NOT_USED: "识图未启用",
    VISION_QA_CODE_FORMAT_ERROR: "识图返回格式异常",
    VISION_QA_CODE_CALL_FAILED: "识图接口调用失败",
    VISION_QA_CODE_QUALITY_FAIL: "图源质量未通过",
    VISION_QA_CODE_UNKNOWN: "未知识图失败",
}


def vision_qa_code_label(code: str | None) -> str:
    if not code:
        return _VISION_QA_CODE_LABELS[VISION_QA_CODE_UNKNOWN]
    return _VISION_QA_CODE_LABELS.get(str(code), _VISION_QA_CODE_LABELS[VISION_QA_CODE_UNKNOWN])


def classify_vision_qa_failure_code(
    *,
    reason: str,
    vision_used: bool,
    pass_: bool = False,
    metrics: dict[str, Any] | None = None,
) -> str:
    """Map internal QA reason to a stable diagnostic code."""
    if pass_:
        return VISION_QA_CODE_PASS

    text = (reason or "").strip()
    metrics = metrics or {}

    if not vision_used:
        if any(k in text for k in ("未检测到产品参考图", "缺少产品参考图", "未选择", "缺少产品")):
            return VISION_QA_CODE_MISSING_IMAGE
        if "未配置" in text and "API Key" in text:
            return VISION_QA_CODE_MISSING_API_KEY
        if "不支持识图" in text:
            return VISION_QA_CODE_MODEL_NOT_VISION
        if "识图模型未调用" in text:
            return VISION_QA_CODE_VISION_NOT_INVOKED
        if "调用失败" in text:
            return VISION_QA_CODE_CALL_FAILED
        return VISION_QA_CODE_VISION_NOT_USED

    if any(k in text for k in ("格式异常", "结果无效", "format_error")):
        return VISION_QA_CODE_FORMAT_ERROR
    if "调用失败" in text:
        return VISION_QA_CODE_CALL_FAILED

    if metrics.get("is_sharp_enough") is False or metrics.get("product_identifiable") is False:
        return VISION_QA_CODE_QUALITY_FAIL
    if metrics.get("is_white_bg") is False and metrics.get("scene_kind") != "interior":
        return VISION_QA_CODE_QUALITY_FAIL

    if text and not pass_:
        return VISION_QA_CODE_QUALITY_FAIL
    return VISION_QA_CODE_UNKNOWN
