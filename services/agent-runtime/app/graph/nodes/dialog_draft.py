"""Phase 2a dialog_draft — prose + macro_schemes dual output (v1.1)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.nodes.plan._shared import latest_user_text
from app.graph.product_visual_v2.models import DialogDraftOutput, MacroScheme, parse_dialog_draft_output
from app.graph.product_visual_v2.macro_select import (
    default_macro_selection,
    pick_macro_scheme_target_count,
    should_skip_macro_hitl,
    trim_macro_schemes_to_count,
)
from app.graph.product_visual_v2.routing import route_after_dialog_draft
from app.graph.nodes.macro_scheme_select_gate import build_macro_select_presentation_patch
from app.graph.product_visual_v2.utterance import extract_user_request_labels
from app.graph.product_visual_v2_prompt import (
    build_dialog_draft_messages,
    build_dialog_draft_user_content,
    load_dialog_draft_prompt,
)

logger = logging.getLogger(__name__)


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

        target_macro_count = pick_macro_scheme_target_count()

        user_content = build_dialog_draft_user_content(
            user_brief=user_brief,
            user_text=user_text,
            revision_feedback=revision_feedback,
            target_macro_count=target_macro_count,
        )
        messages = build_dialog_draft_messages(system=system_prompt, user=user_content)

        draft: DialogDraftOutput | None = None
        for attempt in range(2):
            try:
                ai = await llm.ainvoke(messages)
                raw = str(getattr(ai, "content", ai) or "")
                parsed = parse_dialog_draft_output(raw)
                trimmed = trim_macro_schemes_to_count(
                    [m.model_dump(mode="json") for m in parsed.macro_schemes],
                    target_macro_count,
                )
                if len(trimmed) < target_macro_count and attempt == 0:
                    messages = build_dialog_draft_messages(
                        system=system_prompt,
                        user=user_content
                        + f"\n\n【纠正】上一轮 macro_schemes 只有 {len(trimmed)} 个，必须输出恰好 {target_macro_count} 个。",
                    )
                    continue
                parsed.macro_schemes = [MacroScheme.model_validate(s) for s in trimmed]
                draft = parsed
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
        skip_macro = should_skip_macro_hitl(macro_schemes)
        if skip_macro:
            msg = f"已生成视觉方案（本轮 {target_macro_count} 套），即将写入画布方案节点…"
        else:
            msg = f"已生成视觉方案正文，本轮 {target_macro_count} 套宏观方案，请选择后继续。"

        out: dict[str, Any] = {
            "macro_scheme_draft": draft.draft_prose,
            "macro_schemes": macro_schemes,
            "visual_intent": draft.visual_intent,
            "requires_standard_product_assets": draft.requires_standard_product_assets,
            "prompt_version": prompt_version,
            "phase": next_phase,
            "messages": [AIMessage(content=f"{draft.draft_prose}\n\n---\n{msg}")],
            "product_visual_scheme_v2": True,
            "macro_scheme_target_count": target_macro_count,
        }
        labels = extract_user_request_labels(user_text)
        if labels:
            out["user_request_labels"] = labels
        if skip_macro:
            out["selected_macro_scheme_ids"] = default_macro_selection(macro_schemes)
            out["macro_scheme_decision"] = "auto"
        elif next_phase == "await_macro_scheme_select":
            out.update(build_macro_select_presentation_patch(out))
        return out

    return dialog_draft
