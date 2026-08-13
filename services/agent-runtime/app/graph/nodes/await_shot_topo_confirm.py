"""UX-PV-10: merged shot + topo confirm gate (single hard-stop)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.intent import classify_topo_decision
from app.graph.nodes.split_product_visual import _merge_phase1_items
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.manifest import build_gen_items_from_shots, required_phase1_keys
from app.graph.product_visual_v2.presentation import build_context_recap, build_presentation_envelope
from app.graph.product_visual_v2.routing import is_fast_mode_gate_enabled


def route_after_await_shot_topo_confirm(state: dict) -> str:
    phase = state.get("phase")
    if phase == "error":
        return "done"
    if phase == "orchestrate_shots":
        return "orchestrate_shots"
    if phase == "decompose_from_ssot":
        return "decompose_from_ssot"
    return "end"


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


def preview_manifest_from_shots(state: dict) -> list[dict[str, Any]]:
    """Dry-run split manifest for merged gate topo preview (no canvas writes)."""
    shots = state.get("shot_manifest") or []
    if not isinstance(shots, list) or not shots:
        return []
    visual_intent = state.get("visual_intent") if isinstance(state.get("visual_intent"), dict) else {}
    downstream = build_gen_items_from_shots(shots, visual_intent=visual_intent)
    needed = set(required_phase1_keys(shots))
    phase1 = [it for it in _merge_phase1_items(state) if str(it.get("key") or "") in needed]
    return [*phase1, *downstream]


def _eligible_fast_mode(state: dict) -> bool:
    if not is_fast_mode_gate_enabled():
        return False
    selected = [str(s).strip() for s in (state.get("selected_macro_scheme_ids") or []) if str(s).strip()]
    if len(selected) > 1:
        return False
    qa = state.get("image_qa_result")
    if qa not in (None, "pass", "remediated"):
        return False
    confidence = float(state.get("parse_confidence") or 0.0)
    return confidence >= 0.8


def make_await_shot_topo_confirm_node(*, skills_dir: Any | None = None) -> Callable:
    async def await_shot_topo_confirm(state: dict) -> dict:
        if _last_role(state.get("messages") or []) not in ("human", "user"):
            return _build_gate_output(state, skills_dir=skills_dir)

        text = _latest_user_text(state.get("messages") or [])
        ud = state.get("user_decision")
        if ud in ("confirm", "confirm_gen", "fast_confirm"):
            decision = "confirm_gen"
        else:
            decision = classify_topo_decision(text)

        if decision == "confirm_gen":
            if not (state.get("shot_manifest") or []):
                from app.graph.product_visual_v2.errors import format_flow_end_message

                return {
                    "phase": "error",
                    "last_error": "shot_manifest_missing",
                    "user_decision": "none",
                    "messages": [
                        AIMessage(content=format_flow_end_message("shot_manifest_missing", state))
                    ],
                }
            return {
                "phase": "orchestrate_shots",
                "pv_skip_topo_gate": True,
                "user_decision": "none",
                "messages": [AIMessage(content="正在写入画布并排布出图拓扑…")],
            }
        if decision == "revise" or any(k in text for k in ("调整构图", "去掉", "删减")):
            return {
                "phase": "decompose_from_ssot",
                "user_decision": "none",
                "messages": [AIMessage(content="好的，正在重新拆解构图…")],
            }

        return _build_gate_output(state, skills_dir=skills_dir, extra_tip="请确认构图并开始出图，或说明如何调整。")

    return await_shot_topo_confirm


def _build_gate_output(
    state: dict,
    *,
    skills_dir: Any | None = None,
    extra_tip: str = "",
) -> dict[str, Any]:
    from pathlib import Path

    from app.config import settings

    resolved_skills = Path(skills_dir or settings.skills_dir)
    preview_manifest = preview_manifest_from_shots(state)
    pres_state = {**state, "split_manifest": preview_manifest}
    copy = ProductVisualCopy.load_from_skill(
        "ecommerce-product-visual", "1.0.0", skills_dir=resolved_skills
    )
    presentation = build_presentation_envelope(
        kind="shot_topo_merged",
        phase="await_shot_topo_confirm",
        state=pres_state,
        copy=copy,
    )
    if _eligible_fast_mode(state):
        presentation["secondary_action"] = {
            "label": copy.get("merged_shot_topo.fast_label"),
            "message": copy.get("merged_shot_topo.fast_message"),
        }
    recap = build_context_recap(pres_state)
    hint = str((presentation.get("body") or {}).get("text") or "")
    msg_parts = [p for p in (recap, hint, extra_tip) if p]
    return {
        "phase": "await_shot_topo_confirm",
        "presentation": presentation,
        "messages": [AIMessage(content="\n".join(msg_parts))],
    }
