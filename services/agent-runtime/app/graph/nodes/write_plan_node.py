from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.copy_sot import snapshot_copy_sot_fields
from app.graph.context_snapshot import persist_snapshot_from_state
from app.graph.canvas_stage import rollback_stage_safe, stage_failure_message
from app.graph.hitl_resume import GATE_DECISION_CLEAR
from app.graph.plan_clean import strip_plan_preamble


def make_write_plan_node(*, nest: Any) -> Callable:
    async def write_plan_node(state: dict) -> dict:
        draft = strip_plan_preamble(str(state.get("plan_draft") or state.get("plan_summary") or "").strip())
        if not draft:
            return {
                "phase": "await_confirm",
                "user_decision": "none",
                "messages": [AIMessage(content="方案草稿缺失，请说明需求后重试。")],
            }

        try:
            result = await nest.upsert_prompt_node(
                prompt="营销方案",
                content=draft,
                node_id=state.get("plan_node_id"),
                stage=bool(state.get("plan_node_id")),
            )
        except Exception as exc:  # noqa: BLE001
            await rollback_stage_safe(nest)
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=stage_failure_message("方案写入", exc))],
            }
        plan_node_id = result["nodeId"]
        confirmed = (
            "【已确认方案摘要】\n"
            f"{(state.get('plan_summary') or draft[:200]).strip()}\n"
            "已写入画布「营销方案」节点。接下来将拆解画布骨架（先不出图），请稍后确认拓扑与出图。"
        )
        snap_patch = await persist_snapshot_from_state(
            nest,
            {**state, "plan_draft": draft},
            "plan",
        )
        return {
            "phase": "write_plan_node",
            "plan_node_id": plan_node_id,
            "plan_draft": draft,
            "messages": [AIMessage(content=confirmed)],
            **GATE_DECISION_CLEAR,
            **snapshot_copy_sot_fields({**state, "plan_draft": draft}),
            **snap_patch,
        }

    return write_plan_node
