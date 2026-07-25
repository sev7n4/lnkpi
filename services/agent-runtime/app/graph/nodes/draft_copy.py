from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

_COPY_SYSTEM = (
    "你是电商主文案写手。只输出主文案 Markdown 正文，禁止寒暄、禁止解释过程。"
    "根据营销方案摘要写出可直接用于详情页的主文案。"
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
        hint = str(item.get("prompt_hint") or item.get("prompt") or "").strip()

        user_bits = [
            f"方案摘要：\n{plan_summary or '（无）'}",
        ]
        if hint:
            user_bits.append(f"节点提示：\n{hint}")
        if state.get("copy_revise_only") and state.get("messages"):
            for msg in reversed(state.get("messages") or []):
                role = getattr(msg, "type", None) or (
                    msg.get("role") if isinstance(msg, dict) else None
                )
                content = getattr(msg, "content", None) or (
                    msg.get("content") if isinstance(msg, dict) else ""
                )
                if role in ("human", "user") and content:
                    user_bits.append(f"用户修改意见：\n{content}")
                    break

        result = await llm.ainvoke(
            [
                SystemMessage(content=_COPY_SYSTEM),
                HumanMessage(content="\n\n".join(user_bits)),
            ]
        )
        draft = str(getattr(result, "content", "") or "").strip()
        if not draft:
            draft = hint or title

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
