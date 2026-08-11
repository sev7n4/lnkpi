"""Phase 1 product_visual image QA gate + HITL (Task 2)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.phase1_seed import PHASE1_ASSET_KEYS, ensure_phase1_seed_chain
from app.graph.product_visual_v2.routing import is_v2_enabled

QA_FAIL_TIP = (
    "当前成图效果可能不够清晰或未在白底上拍摄。"
    "请选择：重新拍摄上传，或生成标准白底图后继续。"
)
RETAKE_MSG = "好的，请重新拍摄并上传产品图后再试。"
REMEDIATE_PROGRESS_MSG = "正在生成标准白底图与四视图…"
REMEDIATE_DONE_MSG = "已生成标准白底图与四视图，继续策划视觉方案…"

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
    "vision_used": None,
}


def clear_product_visual_abort_state(state: dict) -> dict:
    """Clear product_visual checkpoint fields on retake/abort (AC-2)."""
    return {**state, **_PRODUCT_VISUAL_ABORT_CLEAR}


def derive_qa_metrics(state: dict) -> dict[str, Any]:
    """Derive QA metrics from route_context / sidebar_attachments heuristics."""
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
    """AC-1/AC-2/AC-3: sharpness + white_bg; interior scenes relax white-bg (CVS-03)."""
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
    if any(k in t for k in ("重新拍", "重拍", "retake", "我重新拍", "重新拍摄")):
        return "retake"
    if any(k in t for k in ("白底", "ai_white_bg", "生成标准白底", "生成白底")):
        return "ai_white_bg"
    if t in ("1", "a"):
        return "retake"
    if t in ("2", "b"):
        return "ai_white_bg"
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


def make_image_qa_check_node(*, nest: Any | None = None) -> Callable:
    async def image_qa_check(state: dict) -> dict:
        metrics = derive_qa_metrics(state)
        result = evaluate_image_qa(metrics)
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
            out["messages"] = [AIMessage(content=QA_FAIL_TIP)]
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
            out["messages"] = [AIMessage(content=QA_FAIL_TIP)]
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
                "messages": [AIMessage(content=RETAKE_MSG)],
            }
        if decision == "ai_white_bg":
            progress = [AIMessage(content=REMEDIATE_PROGRESS_MSG)]
            manifest, err = await ensure_phase1_seed_chain(
                nest, state, run_generation=True
            )
            if err:
                return {**err, "messages": progress + list(err.get("messages") or [])}
            return {
                "image_qa_result": "remediated",
                "phase1_asset_keys": list(PHASE1_ASSET_KEYS),
                "split_manifest": manifest,
                "phase": "dialog_draft" if is_v2_enabled(state) else "plan_product_visual",
                "product_visual_scheme_v2": is_v2_enabled(state) or None,
                "messages": progress + [AIMessage(content=REMEDIATE_DONE_MSG)],
            }
        return {"phase": "await_image_qa", "image_qa_decision": "none"}

    return image_qa_remedy

