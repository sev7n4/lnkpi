from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.copy_alignment import (
    _MAX_COPY_ATTEMPTS,
    build_copy_writer_context,
    validate_copy_alignment,
)
from app.graph.copy_sot import resolve_copy_sot, snapshot_copy_sot_fields
from app.graph.few_shot import build_llm_messages, few_shots_for_skill

_COPY_SYSTEM = (
    "你是电商主文案写手。只输出主文案 Markdown 正文，禁止寒暄、禁止解释过程。"
    "必须严格依据【用户需求锚定】与【已确认营销方案】中的产品品类与品牌撰写，"
    "禁止替换为其他行业或产品（例如用户要耳机时不得写破壁机、乳胶枕、空气净化器等）。"
    "正文必须包含【必须出现的关键词】中的品牌与产品词。"
)

_DRAFT_FOOTER_OK = (
    "\n\n请确认后回复「写入主文案」；如需修改请说明（例如「文案改成更强调降噪」）。"
    "拓扑确认无误后回复「确认出图」。"
)

_DRAFT_FOOTER_BLOCKED = (
    "\n\n⚠️ 主文案与方案/需求可能不一致，写入画布前会被系统拦截。"
    "请说明修改意见后我会重新生成，或点「换方向」重开方案。"
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
        hint = str(item.get("prompt_hint") or item.get("prompt") or "").strip()

        sot = await resolve_copy_sot(state, nest)
        user_brief = sot.user_brief
        plan_draft = sot.plan_draft

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

        if state.get("copy_write_blocked") and state.get("copy_revise_only") and not user_revision:
            user_revision = "请严格按方案中的品牌与产品品类重写主文案，禁止换品类。"

        draft = ""
        alignment_feedback = ""
        aligned = False
        has_sot = bool(user_brief or plan_draft)
        for attempt in range(_MAX_COPY_ATTEMPTS):
            content = build_copy_writer_context(
                user_brief=user_brief,
                plan_draft=plan_draft,
                plan_summary=plan_summary,
                hint=hint,
                user_revision=user_revision,
                alignment_feedback=alignment_feedback,
            )
            few_shots = few_shots_for_skill(
                str(state.get("skill_id") or "") or None,
                "draft_copy",
            )
            result = await llm.ainvoke(
                build_llm_messages(
                    system=_COPY_SYSTEM,
                    user=content,
                    few_shots=few_shots,
                )
            )
            draft = str(getattr(result, "content", "") or "").strip()
            if not draft:
                draft = hint or title
            if not has_sot:
                aligned = False
                break
            ok, reason = validate_copy_alignment(user_brief, plan_draft, draft)
            if ok:
                aligned = True
                break
            alignment_feedback = reason or "与方案不一致"
            if attempt >= _MAX_COPY_ATTEMPTS - 1:
                break

        footer = _DRAFT_FOOTER_OK if aligned else _DRAFT_FOOTER_BLOCKED
        body = f"【主文案草稿】\n{draft}{footer}"
        emit = getattr(nest, "emit_text", None)
        if emit is not None:
            await emit(body)

        emit_upd = getattr(nest, "emit_task_update", None)
        if emit_upd is not None:
            await emit_upd(
                id=key,
                status="needs_user",
                errorHint="请确认主文案后写入" if aligned else "主文案需修改后再写入",
            )

        return {
            "phase": "await_copy_confirm",
            "copy_draft": draft,
            "copy_node_id": node_id,
            "copy_revise_only": False,
            "copy_write_blocked": False,
            "copy_alignment_ok": aligned,
            "messages": [AIMessage(content=body)],
            **snapshot_copy_sot_fields(
                {**state, "user_brief": user_brief, "plan_draft": plan_draft}
            ),
        }

    return draft_copy
