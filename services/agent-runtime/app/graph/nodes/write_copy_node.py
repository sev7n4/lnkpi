from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.copy_alignment import validate_copy_alignment
from app.graph.canvas_stage import rollback_stage_safe, stage_failure_message
from app.graph.copy_sot import resolve_copy_sot, snapshot_copy_sot_fields
from app.graph.hitl_resume import GATE_DECISION_CLEAR


def make_write_copy_node(*, nest: Any) -> Callable:
    async def write_copy_node(state: dict) -> dict:
        node_id = str(state.get("copy_node_id") or "").strip()
        draft = str(state.get("copy_draft") or "").strip()
        if not node_id or not draft:
            return {
                "phase": "done",
                "messages": [AIMessage(content="主文案草稿缺失，无法写入节点。")],
            }

        sot = await resolve_copy_sot(state, nest)
        ok, reason = validate_copy_alignment(sot.user_brief, sot.plan_draft, draft)
        if not ok:
            return {
                "phase": "await_copy_confirm",
                "copy_revise_only": True,
                "copy_write_blocked": True,
                "copy_alignment_ok": False,
                "messages": [
                    AIMessage(
                        content=f"⚠️ {reason}\n正在重新生成主文案，请稍候…"
                    )
                ],
                **snapshot_copy_sot_fields(
                    {**state, "user_brief": sot.user_brief, "plan_draft": sot.plan_draft}
                ),
            }

        try:
            await nest.set_node_content(
                node_id, draft, stage=bool(state.get("split_manifest"))
            )
        except Exception as exc:  # noqa: BLE001
            await rollback_stage_safe(nest)
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=stage_failure_message("主文案写入", exc))],
            }

        key = "copy_main"
        for raw in state.get("split_manifest") or []:
            if isinstance(raw, dict) and str(raw.get("node_id") or "") == node_id:
                key = str(raw.get("key") or key)
                break

        emit_upd = getattr(nest, "emit_task_update", None)
        if emit_upd is not None:
            await emit_upd(id=key, status="done")

        stay_topo = bool(state.get("split_manifest"))
        return {
            "phase": "await_topo" if stay_topo else "done",
            "copy_revise_only": False,
            "copy_write_blocked": False,
            "copy_alignment_ok": True,
            "messages": [
                AIMessage(content="已将确认的主文案写入画布节点。可继续改拓扑或回复「确认出图」。")
            ],
            **GATE_DECISION_CLEAR,
            **snapshot_copy_sot_fields(
                {**state, "user_brief": sot.user_brief, "plan_draft": sot.plan_draft}
            ),
        }

    return write_copy_node
