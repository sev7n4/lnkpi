"""Vision-first QA for v2 (spec R-Vision-QA)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class VisionQAResult(BaseModel):
    pass_: bool = Field(alias="pass")
    reason: str = ""
    vision_used: bool = False
    is_white_bg: bool | None = None
    is_sharp_enough: bool | None = None
    product_identifiable: bool | None = None

    model_config = {"populate_by_name": True}


def vision_qa_metrics_from_result(vision: VisionQAResult) -> dict[str, Any]:
    return {
        "is_white_bg": vision.is_white_bg,
        "is_sharp_enough": vision.is_sharp_enough,
        "product_identifiable": vision.product_identifiable,
        "vision_used": vision.vision_used,
    }


def build_qa_fail_message(
    vision: VisionQAResult | None,
    metrics: dict[str, Any] | None = None,
) -> str:
    """User-facing fail tip with specific vision/heuristic reasons."""
    metrics = metrics or {}
    lines: list[str] = []

    if vision and vision.vision_used and vision.reason:
        lines.append(f"识图结论：{vision.reason}")
    elif vision and not vision.vision_used:
        lines.append("未能完成识图审核，请检查是否已选择支持视觉的文本模型（如 Gemini）。")

    checks: list[str] = []
    if vision and vision.is_sharp_enough is not None:
        checks.append(f"清晰度：{'✓ 足够' if vision.is_sharp_enough else '✗ 不足'}")
    if vision and vision.is_white_bg is not None:
        checks.append(f"白底背景：{'✓ 符合' if vision.is_white_bg else '✗ 非白底或杂底'}")
    if vision and vision.product_identifiable is not None:
        checks.append(f"产品可辨：{'✓ 可识别' if vision.product_identifiable else '✗ 难以识别'}")
    if checks:
        lines.append("检查项：" + "；".join(checks))
    elif not metrics.get("has_white_bg") and metrics.get("sharpness", 0) >= 0.5:
        lines.append("检查项：清晰度尚可；白底背景未确认（需识图或用户确认）。")

    lines.append("请选择：确认当前图可用并继续、重新拍摄上传，或生成标准白底图后继续。")
    return "\n".join(lines)


def evaluate_vision_qa_v2(
    vision: VisionQAResult,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    V2 QA requires vision_used=True. Heuristic metrics alone cannot pass.
    Interior white-bg relaxation when vision confirms sharp + identifiable product.
    """
    metrics = metrics or {}
    if not vision.vision_used:
        return {
            "image_qa_result": "fail",
            "phase": "await_image_qa",
            "image_qa_reason": vision.reason or "识图模型未调用，无法完成准入审核",
            "image_qa_metrics": vision_qa_metrics_from_result(vision),
        }

    is_interior = metrics.get("scene_kind") == "interior"
    interior_ok = (
        is_interior
        and vision.is_sharp_enough is not False
        and vision.product_identifiable is not False
    )

    if vision.pass_ or interior_ok:
        reason = vision.reason
        if interior_ok and not vision.pass_:
            reason = f"{vision.reason}（室内场景已放宽白底要求）".strip()
        return {
            "image_qa_result": "pass",
            "phase": "dialog_draft"
            if not metrics.get("requires_standard_product_assets")
            else "phase1_seed_eager",
            "image_qa_reason": reason,
            "vision_used": True,
            "scene_kind": metrics.get("scene_kind"),
            "interior_relaxed": interior_ok and not vision.pass_,
            "image_qa_metrics": vision_qa_metrics_from_result(vision),
        }

    return {
        "image_qa_result": "fail",
        "phase": "await_image_qa",
        "image_qa_reason": vision.reason or "图源未通过识图审核",
        "vision_used": True,
        "image_qa_metrics": vision_qa_metrics_from_result(vision),
    }
