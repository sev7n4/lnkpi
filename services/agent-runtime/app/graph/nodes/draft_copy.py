from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.graph.copy_alignment import build_copy_writer_context, validate_copy_alignment

_COPY_SYSTEM = (
    "你是电商主文案写手。只输出主文案 Markdown 正文，禁止寒暄、禁止解释过程。"
    "必须严格依据【用户需求锚定】与【已确认营销方案】中的产品品类与品牌撰写，"
    "禁止替换为其他行业或产品（例如用户要耳机时不得写破壁机、乳胶枕、马桶等）。"
    "正文必须包含【必须出现的关键词】中的品牌与产品词。"
)

_DRAFT_FOOTER = (
    "\n\n请确认后回复「写入主文案」；如需修改请说明（例如「文案改成更强调节水」）。"
    "拓扑确认无误后回复「确认出图」。"
)


def _pick_copy_item(manifest: list[Any]) -> dict[str, Any] | None:
    for raw in manifest or []:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("key") or "") == "copy_main":
            return raw
    for raw in manifest or []:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("target_type") or "") == "text":
            return raw
    return None


def make_draft_copy_node(*, nest: Any, llm: Any) -> Callable:
    async def draft_copy(state: dict) -> dict:
        item = _pick_copy_item(list(state.get("split_manifest") or []))
        if item is None:
            return {}

        key = str(item.get("key") or "copy_main")
        title = str(item.get("title") or "主文案")
        node_id = str(item.get("node_id") or "") or None
        plan_summary = str(state.get("plan_summary") or "").strip()
        plan_draft = str(state.get("plan_draft") or "").strip()
        user_brief = str(state.get("user_brief") or "").strip()
        hint = str(item.get("prompt_hint") or item.get("prompt") or "").strip()

        user_revision = ""
        if state.get("copy_revise_only") and state.get("messages"):
            for msg in reversed(state.get("messages") or []):
                role = getattr(msg, "type", None) or (
                    msg.get("role") if isinstance(msg, dict) else None
                )
                content = getattr(msg, "content", None) or (
                    msg.get("content") if isinstance(msg, dict) else ""
                )
                if role in ("human", "user") and content:
                    user_revision = str(content)
                    break

        draft = ""
        alignment_feedback = ""
        for attempt in range(3):
            content = build_copy_writer_context(
                user_brief=user_brief,
                plan_draft=plan_draft,
                plan_summary=plan_summary,
                hint=hint,
                user_revision=user_revision,
                alignment_feedback=alignment_feedback,
            )
            result = await llm.ainvoke(
                [
                    SystemMessage(content=_COPY_SYSTEM),
                    HumanMessage(content=content),
                ]
            )
            draft = str(getattr(result, "content", "") or "").strip()
            if not draft:
                draft = hint or title
            ok, reason = validate_copy_alignment(user_brief, plan_draft, draft)
            if ok or (not user_brief and not plan_draft):
                break
            alignment_feedback = reason or "与方案不一致"
            if attempt >= 2:
                break

        body = f"【主文案草稿】\n{draft}{_DRAFT_FOOTER}"
        emit = getattr(nest, "emit_text", None)
        if emit is not None:
            await emit(body)

        emit_upd = getattr(nest, "emit_task_update", None)
        if emit_upd is not None:
            await emit_upd(
                id=key,
                status="needs_user",
                errorHint="请确认主文案后写入",
            )

        was_revise = bool(state.get("copy_revise_only"))
        out: dict[str, Any] = {
            "phase": "await_topo",
            "awaiting_user": True,
            "copy_draft": draft,
            "copy_node_id": node_id,
            "copy_revise_only": False,
            "pending_orchestrate": False,
            "messages": [AIMessage(content=body)],
        }
        if was_revise:
            out["phase"] = "await_copy_confirm"
        return out

    return draft_copy
