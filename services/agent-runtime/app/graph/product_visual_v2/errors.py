"""User-facing error copy for product_visual v2 (no raw codes in chat)."""

from __future__ import annotations

from typing import Any

from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import STEPPER_ORDER, build_context_recap

_ERROR_CODE_MESSAGES: dict[str, str] = {
    "dialog_draft_parse_failed": "视觉方案生成遇到问题，已改用简化方案继续；您也可补充需求后重试。",
    "decompose_shots_parse_failed": "构图拆解失败，请调整宏观方案或补充需求后重试。",
    "shot_manifest_missing": "构图清单尚未就绪，无法继续出图。",
    "plan_node_id_missing": "画布方案节点缺失，无法拆解构图。",
    "upsert_unavailable": "画布服务暂不可用，请稍后重试。",
    "macro_schemes_missing": "宏观方案缺失，请重新描述需求。",
}


def format_flow_end_message(last_error: str, state: dict[str, Any] | None = None) -> str:
    """Map internal last_error codes to user-facing Chinese."""
    err = str(last_error or "").strip()
    if not err:
        return "流程未能完成；您可补充说明后重试，或在画布手动调整。"

    if err in _ERROR_CODE_MESSAGES:
        return _ERROR_CODE_MESSAGES[err]

    lowered = err.lower()
    if "macro" in lowered and "shots" in lowered and "max" in lowered:
        return "部分方案构图较多，系统已自动合并；若结果不符预期请调整需求后重试。"

    if lowered.startswith("downstream") and "exceeds" in lowered:
        return "本次出图任务量超出上限，系统已自动精简构图数量。"

    if err.startswith("流程结束。"):
        tail = err.removeprefix("流程结束。").strip()
        return format_flow_end_message(tail, state)

    if any(ch in err for ch in ("失败", "缺失", "无法", "不可用", "请")):
        return err

    return f"流程未能完成：{err}。您可补充说明后重试，或在画布手动调整。"


def build_error_presentation(
    state: dict[str, Any],
    *,
    copy: ProductVisualCopy | None = None,
) -> dict[str, Any]:
    """Done-phase error envelope — stepper at done, no stale macro cards."""
    if copy is None:
        copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")

    msg = format_flow_end_message(str(state.get("last_error") or ""), state)
    return {
        "kind": "callout_error",
        "stepper": {
            "current": "done",
            "completed": [s for s in STEPPER_ORDER if s != "done"],
        },
        "context_recap": build_context_recap(state),
        "body": {"text": msg},
        "title": copy.get("error.flow_end_title") or "未能完成出图",
    }
