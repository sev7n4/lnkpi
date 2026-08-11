"""Phase 2c canvas SSOT commit (v1.1)."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.product_visual_v2.ssot import build_ssot_prose, is_prose_content


def _section_body_for_macro(draft: str, macro_id: str, schemes: list[dict]) -> str:
    """Use full draft for single macro; for multi, prefer draft until per-section extraction exists."""
    if len(schemes) <= 1:
        return draft.strip()
    marker = f"## 方案 {macro_id}"
    if marker in draft:
        parts = draft.split("## 方案 ")
        for part in parts[1:]:
            if part.strip().startswith(macro_id):
                return part.split("\n", 1)[-1].strip()
    return draft.strip()


def build_ssot_content_from_state(state: dict) -> str:
    draft = str(state.get("macro_scheme_draft") or "").strip()
    selected = [str(s) for s in (state.get("selected_macro_scheme_ids") or []) if str(s).strip()]
    schemes = state.get("macro_schemes") or []
    if not draft or not selected:
        raise ValueError("missing draft or selected macro schemes")

    if len(selected) == 1:
        body = _section_body_for_macro(draft, selected[0], schemes)
        return body

    sections = {
        sid: _section_body_for_macro(draft, sid, schemes)
        for sid in selected
    }
    return build_ssot_prose(sections=sections, merge_mode="parallel")


def make_canvas_ssot_commit_node(*, nest: Any) -> Callable:
    async def canvas_ssot_commit(state: dict) -> dict:
        upsert = getattr(nest, "upsert_prompt_node", None)
        if upsert is None:
            return {
                "phase": "error",
                "last_error": "upsert_prompt_node_unavailable",
                "messages": [AIMessage(content="无法写入画布方案节点。")],
            }
        try:
            content = build_ssot_content_from_state(state)
        except ValueError as exc:
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content="方案内容缺失，无法写入画布。")],
            }

        if not is_prose_content(content, min_length=50):
            return {
                "phase": "error",
                "last_error": "ssot_not_prose",
                "messages": [AIMessage(content="方案正文格式无效，请重新生成。")],
            }

        intent = state.get("visual_intent") if isinstance(state.get("visual_intent"), dict) else {}
        goal = str(intent.get("primary_goal") or "product visual").strip()
        result = await upsert(prompt=f"视觉方案：{goal}", content=content)
        plan_node_id = str(result.get("nodeId") or "").strip()
        if not plan_node_id:
            return {
                "phase": "error",
                "last_error": "ssot_node_id_missing",
                "messages": [AIMessage(content="写入画布方案节点失败。")],
            }

        return {
            "plan_node_id": plan_node_id,
            "phase": "decompose_from_ssot",
            "messages": [AIMessage(content="已将选定方案写入画布，正在拆解构图任务…")],
        }

    return canvas_ssot_commit
