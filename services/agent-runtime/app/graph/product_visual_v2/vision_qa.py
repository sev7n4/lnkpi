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


def build_qa_checks(
    vision: VisionQAResult | None,
    metrics: dict[str, Any] | None = None,
) -> list[str]:
    """Human-readable QA check lines for presentation.body.checks[]."""
    metrics = metrics or {}
    checks: list[str] = []

    sharp = vision.is_sharp_enough if vision and vision.is_sharp_enough is not None else None
    if sharp is None and metrics.get("sharpness") is not None:
        sharp = float(metrics["sharpness"]) >= 0.5
    if sharp is not None:
        checks.append(f"清晰度：{'✓ 足够' if sharp else '✗ 不足'}")

    white = vision.is_white_bg if vision and vision.is_white_bg is not None else None
    if white is None and metrics.get("has_white_bg"):
        white = True
    if white is not None:
        checks.append(f"白底背景：{'✓ 符合' if white else '✗ 非白底或杂底'}")

    identifiable = (
        vision.product_identifiable if vision and vision.product_identifiable is not None else None
    )
    if identifiable is not None:
        checks.append(f"产品可辨：{'✓ 可识别' if identifiable else '✗ 难以识别'}")

    if not checks and not metrics.get("has_white_bg") and metrics.get("sharpness", 0) >= 0.5:
        checks.append("清晰度尚可；白底背景未确认")
    return checks


def build_qa_fail_message(
    vision: VisionQAResult | None,
    metrics: dict[str, Any] | None = None,
    *,
    copy: Any | None = None,
    context_recap: str = "",
) -> str:
    """User-facing fail tip — friendly title + optional context recap (no technical reason)."""
    from app.graph.product_visual_copy import ProductVisualCopy

    metrics = metrics or {}
    pv_copy = copy or ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    mapped = pv_copy.map_qa_failure(
        reason=str(getattr(vision, "reason", None) or ""),
        vision_used=bool(getattr(vision, "vision_used", False)) if vision else False,
        metrics={**metrics, **vision_qa_metrics_from_result(vision)} if vision else metrics,
    )
    parts: list[str] = []
    if context_recap:
        parts.append(context_recap)
    parts.append(str(mapped.get("title") or ""))
    body = str(mapped.get("body") or "").strip()
    if body:
        parts.append(body)
    checks = build_qa_checks(vision, metrics)
    if checks:
        parts.append("检查项：" + "；".join(checks))
    return "\n".join(p for p in parts if p)


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
