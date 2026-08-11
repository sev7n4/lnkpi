"""Vision-first QA for v2 (spec R-Vision-QA)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class VisionQAResult(BaseModel):
    pass_: bool = Field(alias="pass")
    reason: str = ""
    vision_used: bool = False

    model_config = {"populate_by_name": True}


def evaluate_vision_qa_v2(
    vision: VisionQAResult,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    V2 QA requires vision_used=True. Heuristic metrics alone cannot pass.
    Interior white-bg relaxation still applies when vision passes.
    """
    metrics = metrics or {}
    if not vision.vision_used:
        return {
            "image_qa_result": "fail",
            "phase": "await_image_qa",
            "image_qa_reason": "识图模型未调用，无法完成准入审核",
        }
    is_interior = metrics.get("scene_kind") == "interior"
    if vision.pass_:
        return {
            "image_qa_result": "pass",
            "phase": "dialog_draft" if not metrics.get("requires_standard_product_assets") else "phase1_seed_eager",
            "image_qa_reason": vision.reason,
            "vision_used": True,
            "scene_kind": metrics.get("scene_kind"),
            "interior_relaxed": is_interior,
        }
    return {
        "image_qa_result": "fail",
        "phase": "await_image_qa",
        "image_qa_reason": vision.reason or "图源未通过识图审核",
        "vision_used": True,
    }
