"""Phase 1 product_visual image QA gate + HITL (Task 2)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.phase1_seed import PHASE1_ASSET_KEYS, ensure_phase1_seed_chain
from app.graph.product_visual_v2.routing import is_v2_enabled
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import (
    build_context_recap,
    build_presentation_envelope,
)
from app.graph.product_visual_v2.vision_qa import (
    VisionQAResult,
    build_qa_checks,
    evaluate_vision_qa_v2,
    vision_qa_metrics_from_result,
)
from app.graph.product_visual_v2.vision_qa_client import image_urls_from_state, run_vision_qa

REMEDIATE_PROGRESS_MSG = "正在生成标准白底图与四视图…"
REMEDIATE_DONE_MSG = "已生成标准白底图与四视图，继续策划视觉方案…"
REMEDIATE_PROGRESS_MSG_V2 = "正在准备标准白底图与四视图节点…"
REMEDIATE_DONE_MSG_V2 = "已创建标准白底图与四视图节点，出图将在方案确认后进行…"

_PRODUCT_VISUAL_ABORT_CLEAR: dict[str, Any] = {
    "product_visual_plan": None,
    "image_qa_result": None,
    "phase1_asset_keys": None,
    "scheme_revision_count": None,
    "delivery_selections": None,
    "image_qa_decision": None,
    "plan_node_id": None,
    "macro_scheme_draft": None,
    "macro_schemes": None,
    "selected_macro_scheme_ids": None,
    "macro_scheme_decision": None,
    "shot_manifest": None,
    "visual_intent": None,
    "requires_standard_product_assets": None,
    "image_qa_reason": None,
    "image_qa_metrics": None,
    "vision_used": None,
}


def clear_product_visual_abort_state(state: dict) -> dict:
    """Clear product_visual checkpoint fields on retake/abort (AC-2)."""
    return {**state, **_PRODUCT_VISUAL_ABORT_CLEAR}


def derive_qa_metrics(state: dict) -> dict[str, Any]:
    """Derive auxiliary QA signals from route_context / sidebar_attachments."""
    route_ctx = state.get("route_context") or {}
    attachments = list(state.get("sidebar_attachments") or route_ctx.get("sidebar_attachments") or [])

    scene_kind = str(route_ctx.get("scene_kind") or "").strip()
    utterance = str(route_ctx.get("utterance") or "").strip()
    if not scene_kind and any(k in utterance for k in ("室内", "装修", "空间", "interior")):
        scene_kind = "interior"

    has_white_bg = False
    sharpness = 0.7

    for att in attachments:
        if not isinstance(att, dict):
            continue
        role = str(att.get("role") or "").lower()
        meta = att.get("metadata") if isinstance(att.get("metadata"), dict) else {}
        if att.get("has_white_bg") or meta.get("has_white_bg") or role in ("white_bg", "white-background"):
            has_white_bg = True
        if att.get("sharpness") is not None:
            sharpness = float(att["sharpness"])
        elif meta.get("sharpness") is not None:
            sharpness = float(meta["sharpness"])
        elif role == "product":
            sharpness = max(sharpness, 0.6)

    return {
        "sharpness": sharpness,
        "has_white_bg": has_white_bg,
        "scene_kind": scene_kind or None,
    }


def evaluate_image_qa(metrics: dict) -> dict:
    """Legacy heuristic QA (fallback when vision unavailable)."""
    is_interior = metrics.get("scene_kind") == "interior"
    white_ok = metrics.get("has_white_bg") or is_interior
    sharp_ok = metrics.get("sharpness", 0) >= 0.5
    if sharp_ok and white_ok:
        return {"image_qa_result": "pass", "phase": "plan_product_visual"}
    return {"image_qa_result": "fail", "phase": "await_image_qa"}


def classify_image_qa_decision(text: str) -> str:
    t = (text or "").strip().lower()
    if not t:
        return "none"
    if any(k in t for k in ("已是白底", "继续使用", "确认可用", "继续策划", "就用这张图", "confirm_pass")):
        return "confirm_pass"
    if any(k in t for k in ("重新拍", "重拍", "retake", "我重新拍", "重新拍摄")):
        return "retake"
    if any(k in t for k in ("白底", "ai_white_bg", "生成标准白底", "生成白底")):
        return "ai_white_bg"
    if t in ("1", "a"):
        return "retake"
    if t in ("2", "b"):
        return "ai_white_bg"
    if t in ("3", "c"):
        return "confirm_pass"
    return "none"


def _latest_user_text(messages: list[Any]) -> str:
    for msg in reversed(messages or []):
        role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
        content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
        if role in ("human", "user") and content:
            return str(content)
    return ""


def _last_role(messages: list[Any]) -> str | None:
    if not messages:
        return None
    last = messages[-1]
    return getattr(last, "type", None) or (last.get("role") if isinstance(last, dict) else None)


def _load_product_visual_copy(skills_dir: Path | None) -> ProductVisualCopy:
    if skills_dir is not None:
        return ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0", skills_dir=skills_dir)
    return ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")


def _build_qa_fail_output(
    state: dict,
    *,
    vision: VisionQAResult | None,
    metrics: dict[str, Any],
    result: dict[str, Any],
    skills_dir: Path | None,
) -> dict[str, Any]:
    """Build presentation envelope + friendly AIMessage for QA fail."""
    copy = _load_product_visual_copy(skills_dir)
    reason = str(result.get("image_qa_reason") or getattr(vision, "reason", None) or "")
    vision_used = bool(result.get("vision_used")) if result.get("vision_used") is not None else bool(
        getattr(vision, "vision_used", False)
    )
    merged_metrics: dict[str, Any] = {**metrics, **(result.get("image_qa_metrics") or {})}
    if vision:
        merged_metrics = {**merged_metrics, **vision_qa_metrics_from_result(vision)}

    mapped = copy.map_qa_failure(reason=reason, vision_used=vision_used, metrics=merged_metrics)
    checks = build_qa_checks(vision, merged_metrics)
    recap = build_context_recap(state)
    presentation = build_presentation_envelope(
        kind=str(mapped["kind"]),
        phase="await_image_qa",
        state=state,
        copy=copy,
    )
    presentation["title"] = mapped["title"]
    presentation["body"] = {"text": mapped["body"], "checks": checks}
    presentation["options"] = mapped["options"]

    msg_parts = [p for p in (recap, str(mapped.get("title") or "")) if p]
    return {
        "presentation": presentation,
        "messages": [AIMessage(content="\n".join(msg_parts))],
    }


async def _run_qa_check(
    state: dict,
    *,
    nest: Any | None,
    skills_dir: Path | None,
    vision_creds: dict[str, str | None] | None,
) -> dict[str, Any]:
    metrics = derive_qa_metrics(state)
    v2 = is_v2_enabled(state)
    urls = image_urls_from_state(state)
    vision = None

    if urls and skills_dir is not None:
        state_with_metrics = {**state, "_qa_metrics": metrics}
        vision = await run_vision_qa(
            nest=nest,
            state=state_with_metrics,
            skills_dir=skills_dir,
            vision_creds=vision_creds,
        )
        if v2 or vision.vision_used:
            return evaluate_vision_qa_v2(vision, metrics)

    if v2:
        return evaluate_vision_qa_v2(
            vision
            or VisionQAResult(
                pass_=False,
                reason="缺少产品参考图或未配置识图模型",
                vision_used=False,
            ),
            metrics,
        )

    result = evaluate_image_qa(metrics)
    out = dict(result)
    if vision and vision.vision_used:
        out["image_qa_reason"] = vision.reason
        out["vision_used"] = True
        out["image_qa_metrics"] = {
            "is_white_bg": vision.is_white_bg,
            "is_sharp_enough": vision.is_sharp_enough,
            "product_identifiable": vision.product_identifiable,
            "vision_used": True,
        }
    return out


def make_image_qa_check_node(
    *,
    nest: Any | None = None,
    skills_dir: Path | None = None,
    vision_creds: dict[str, str | None] | None = None,
) -> Callable:
    resolved_skills = skills_dir

    async def image_qa_check(state: dict) -> dict:
        result = await _run_qa_check(
            state, nest=nest, skills_dir=resolved_skills, vision_creds=vision_creds
        )
        metrics = derive_qa_metrics(state)
        out: dict[str, Any] = {"phase": "image_qa", **result}
        if result["image_qa_result"] == "pass":
            if is_v2_enabled(state):
                out["product_visual_scheme_v2"] = True
                out["phase"] = "dialog_draft"
            else:
                manifest, err = await ensure_phase1_seed_chain(nest, state, run_generation=False)
                if err:
                    return {**out, **err}
                out["phase1_asset_keys"] = list(PHASE1_ASSET_KEYS)
                out["split_manifest"] = manifest
        elif result["image_qa_result"] == "fail":
            m = result.get("image_qa_metrics") or {}
            vision_stub = VisionQAResult(
                pass_=False,
                reason=str(result.get("image_qa_reason") or ""),
                vision_used=bool(result.get("vision_used")),
                is_white_bg=m.get("is_white_bg"),
                is_sharp_enough=m.get("is_sharp_enough"),
                product_identifiable=m.get("product_identifiable"),
            )
            out.update(
                _build_qa_fail_output(
                    state,
                    vision=vision_stub,
                    metrics=metrics,
                    result=result,
                    skills_dir=resolved_skills,
                )
            )
        return out

    return image_qa_check


def make_await_image_qa_node() -> Callable:
    async def await_image_qa(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return {"phase": "await_image_qa", "image_qa_decision": "none"}

        text = _latest_user_text(state.get("messages") or [])
        decision = classify_image_qa_decision(text)
        out: dict[str, Any] = {
            "phase": "await_image_qa",
            "image_qa_decision": decision,
        }
        if decision == "none":
            metrics = derive_qa_metrics(state)
            m = state.get("image_qa_metrics") or {}
            vision_stub = VisionQAResult(
                pass_=False,
                reason=str(state.get("image_qa_reason") or ""),
                vision_used=bool(state.get("vision_used")),
                is_white_bg=m.get("is_white_bg") if isinstance(m, dict) else None,
                is_sharp_enough=m.get("is_sharp_enough") if isinstance(m, dict) else None,
                product_identifiable=m.get("product_identifiable") if isinstance(m, dict) else None,
            )
            fail_bits = _build_qa_fail_output(
                state,
                vision=vision_stub,
                metrics=metrics,
                result={
                    "image_qa_reason": state.get("image_qa_reason"),
                    "vision_used": state.get("vision_used"),
                    "image_qa_metrics": m,
                },
                skills_dir=None,
            )
            out.update(fail_bits)
        return out

    return await_image_qa


def make_image_qa_remedy_node(*, nest: Any | None = None) -> Callable:
    async def image_qa_remedy(state: dict) -> dict:
        decision = state.get("image_qa_decision") or "none"
        if decision == "retake":
            cleared = clear_product_visual_abort_state(state)
            return {
                **{k: cleared[k] for k in _PRODUCT_VISUAL_ABORT_CLEAR},
                "phase": "done",
                "messages": [AIMessage(content="好的，请重新拍摄并上传产品图后再试。")],
            }
        if decision == "confirm_pass":
            v2 = is_v2_enabled(state)
            return {
                "image_qa_result": "pass",
                "image_qa_reason": "用户确认当前图源可用",
                "phase": "dialog_draft" if v2 else "plan_product_visual",
                "product_visual_scheme_v2": v2 or None,
                "messages": [AIMessage(content="已确认使用当前产品图，继续策划视觉方案…")],
            }
        if decision == "ai_white_bg":
            v2 = is_v2_enabled(state)
            progress_msg = REMEDIATE_PROGRESS_MSG_V2 if v2 else REMEDIATE_PROGRESS_MSG
            done_msg = REMEDIATE_DONE_MSG_V2 if v2 else REMEDIATE_DONE_MSG
            progress = [AIMessage(content=progress_msg)]
            manifest, err = await ensure_phase1_seed_chain(
                nest, state, run_generation=not v2
            )
            if err:
                return {**err, "messages": progress + list(err.get("messages") or [])}
            return {
                "image_qa_result": "remediated",
                "phase1_asset_keys": list(PHASE1_ASSET_KEYS),
                "split_manifest": manifest,
                "phase": "dialog_draft" if v2 else "plan_product_visual",
                "product_visual_scheme_v2": v2 or None,
                "messages": progress + [AIMessage(content=done_msg)],
            }
        return {"phase": "await_image_qa", "image_qa_decision": "none"}

    return image_qa_remedy
