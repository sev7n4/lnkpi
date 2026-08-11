"""Phase 3a decompose_from_ssot — L2 shot text nodes (v1.1)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.atomic_parse_llm import extract_json_object
from app.graph.nodes.plan._shared import latest_user_text
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.limits import validate_downstream_limit, validate_shots_per_macro
from app.graph.product_visual_v2.models import ShotManifestItem
from app.graph.product_visual_v2.presentation import build_context_recap, build_presentation_envelope
from app.graph.product_visual_v2.routing import shot_confirm_gate_name
from app.graph.product_visual_v2_prompt import (
    build_decompose_messages,
    build_decompose_user_content,
    load_decompose_shots_prompt,
)

logger = logging.getLogger(__name__)


def parse_shots_from_llm(raw: str) -> list[dict[str, Any]]:
    data = extract_json_object(raw)
    shots = data.get("shots") if isinstance(data, dict) else None
    if not isinstance(shots, list):
        raise ValueError("shots array missing")
    out: list[dict[str, Any]] = []
    for item in shots:
        parsed = ShotManifestItem.model_validate(item)
        out.append(parsed.model_dump(mode="json"))
    return out


def make_decompose_from_ssot_node(*, llm: Any, skills_dir: Path, nest: Any) -> Callable:
    async def decompose_from_ssot(state: dict) -> dict:
        plan_node_id = str(state.get("plan_node_id") or "").strip()
        if not plan_node_id:
            return {
                "phase": "error",
                "last_error": "plan_node_id_missing",
                "messages": [AIMessage(content="画布方案节点缺失，无法拆解。")],
            }

        ssot_prose = str(state.get("macro_scheme_draft") or "").strip()
        get_node = getattr(nest, "get_node_content", None)
        if get_node is not None:
            try:
                fetched = await get_node(plan_node_id)
                if isinstance(fetched, dict) and fetched.get("content"):
                    ssot_prose = str(fetched["content"]).strip()
            except Exception:  # noqa: BLE001
                pass

        selected = [str(s) for s in (state.get("selected_macro_scheme_ids") or []) if str(s).strip()]
        user_text = latest_user_text(state.get("messages") or [])

        system_prompt, prompt_version = load_decompose_shots_prompt(skills_dir)
        user_content = build_decompose_user_content(
            ssot_prose=ssot_prose,
            user_text=user_text,
            selected_macro_ids=selected or ["A"],
        )
        messages = build_decompose_messages(system=system_prompt, user=user_content)

        shots: list[dict[str, Any]] | None = None
        for attempt in range(2):
            try:
                ai = await llm.ainvoke(messages)
                raw = str(getattr(ai, "content", ai) or "")
                shots = parse_shots_from_llm(raw)
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning("decompose_from_ssot failed (attempt %s): %s", attempt + 1, exc)

        if not shots:
            return {
                "phase": "error",
                "last_error": "decompose_shots_parse_failed",
                "messages": [AIMessage(content="构图拆解失败，请调整方案后重试。")],
            }

        for macro_id in selected:
            err = validate_shots_per_macro(shots, macro_id)
            if err:
                return {"phase": "error", "last_error": err, "messages": [AIMessage(content=err)]}

        err = validate_downstream_limit(phase1_seed_count=0, shots=shots)
        if err:
            return {"phase": "error", "last_error": err, "messages": [AIMessage(content=err)]}

        upsert = getattr(nest, "upsert_prompt_node", None)
        if upsert is None:
            return {"phase": "error", "last_error": "upsert_unavailable", "messages": []}

        for shot in shots:
            prose = str(shot.get("shot_prose") or shot.get("label") or "").strip()
            title = f"构图 · {shot.get('label') or shot.get('shot_id')}"
            result = await upsert(prompt=title, content=prose)
            shot["node_id"] = str(result.get("nodeId") or "").strip() or None

        copy = ProductVisualCopy.load_from_skill(
            "ecommerce-product-visual", "1.0.0", skills_dir=skills_dir
        )
        gate_phase = shot_confirm_gate_name()
        pres_state = {**state, "shot_manifest": shots}
        if gate_phase == "await_shot_topo_confirm":
            from app.graph.nodes.await_shot_topo_confirm import preview_manifest_from_shots

            pres_state = {**pres_state, "split_manifest": preview_manifest_from_shots(pres_state)}
        presentation = build_presentation_envelope(
            kind="shot_topo_merged" if gate_phase == "await_shot_topo_confirm" else "shot_table",
            phase=gate_phase,
            state=pres_state,
            copy=copy,
        )
        recap = build_context_recap(pres_state)
        if gate_phase == "await_shot_topo_confirm":
            hint = str((presentation.get("body") or {}).get("text") or "")
            msg_parts = [p for p in (recap, f"已拆解 {len(shots)} 个构图任务。", hint) if p]
        else:
            hint = copy.get("shot_confirm.hint", n=str(len(shots)))
            msg_parts = [p for p in (recap, f"已拆解 {len(shots)} 个构图任务。", hint) if p]

        return {
            "shot_manifest": shots,
            "prompt_version": prompt_version,
            "phase": gate_phase,
            "presentation": presentation,
            "messages": [AIMessage(content="\n".join(msg_parts))],
        }

    return decompose_from_ssot
