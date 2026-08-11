"""Phase 2a dialog_draft — prose + macro_schemes dual output (v1.1)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.nodes.plan._shared import latest_user_text
from app.graph.product_visual_v2.models import DialogDraftOutput, parse_dialog_draft_output
from app.graph.product_visual_v2.macro_select import default_macro_selection, should_skip_macro_hitl
from app.graph.product_visual_v2.routing import route_after_dialog_draft
from app.graph.nodes.macro_scheme_select_gate import build_macro_select_presentation_patch
from app.graph.product_visual_v2.utterance import extract_user_request_labels
from app.graph.product_visual_v2_prompt import (
    build_dialog_draft_messages,
    build_dialog_draft_user_content,
    load_dialog_draft_prompt,
)

logger = logging.getLogger(__name__)

DRAFT_READY_MSG = "已生成视觉方案正文，请选择宏观方案后继续。"
DRAFT_SILENT_MSG = "已生成视觉方案，仅一套宏观方向，即将写入画布方案节点…"


def make_dialog_draft_node(*, llm: Any, skills_dir: Path) -> Callable:
    async def dialog_draft(state: dict) -> dict:
        from app.graph.context_snapshot import resolve_brief_for_llm

        system_prompt, prompt_version = load_dialog_draft_prompt(skills_dir)
        user_brief = await resolve_brief_for_llm(state, None)
        user_text = str(state.get("effective_utterance") or "").strip() or latest_user_text(
            state.get("messages") or []
        )
        revision_feedback = None
        if state.get("scheme_revision_count") and state.get("macro_scheme_revision_feedback"):
            revision_feedback = state.get("macro_scheme_revision_feedback")

        user_content = build_dialog_draft_user_content(
            user_brief=user_brief,
            user_text=user_text,
            revision_feedback=revision_feedback,
        )
        messages = build_dialog_draft_messages(system=system_prompt, user=user_content)

        draft: DialogDraftOutput | None = None
        for attempt in range(2):
            try:
                ai = await llm.ainvoke(messages)
                raw = str(getattr(ai, "content", ai) or "")
                draft = parse_dialog_draft_output(raw)
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning("dialog_draft parse failed (attempt %s): %s", attempt + 1, exc)

        if draft is None:
            return {
                "phase": "error",
                "last_error": "dialog_draft_parse_failed",
                "messages": [AIMessage(content="视觉方案生成失败，请重试或补充需求。")],
            }

        macro_schemes = [m.model_dump(mode="json") for m in draft.macro_schemes]
        next_phase = route_after_dialog_draft({"macro_schemes": macro_schemes, "phase": None})
        msg = DRAFT_SILENT_MSG if should_skip_macro_hitl(macro_schemes) else DRAFT_READY_MSG

        out: dict[str, Any] = {
            "macro_scheme_draft": draft.draft_prose,
            "macro_schemes": macro_schemes,
            "visual_intent": draft.visual_intent,
            "requires_standard_product_assets": draft.requires_standard_product_assets,
            "prompt_version": prompt_version,
            "phase": next_phase,
            "messages": [AIMessage(content=f"{draft.draft_prose}\n\n---\n{msg}")],
            "product_visual_scheme_v2": True,
        }
        labels = extract_user_request_labels(user_text)
        if labels:
            out["user_request_labels"] = labels
        if should_skip_macro_hitl(macro_schemes):
            out["selected_macro_scheme_ids"] = default_macro_selection(macro_schemes)
            out["macro_scheme_decision"] = "auto"
        elif next_phase == "await_macro_scheme_select":
            out.update(build_macro_select_presentation_patch(out))
        return out

    return dialog_draft
