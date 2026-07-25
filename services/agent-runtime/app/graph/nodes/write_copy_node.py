from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def make_write_copy_node(*, nest: Any) -> Callable:
    async def write_copy_node(state: dict) -> dict:
        node_id = str(state.get("copy_node_id") or "").strip()
        draft = str(state.get("copy_draft") or "").strip()
        if not node_id or not draft:
            return {
                "phase": "done",
                "awaiting_user": False,
                "messages": [AIMessage(content="主文案草稿缺失，无法写入节点。")],
            }

        await nest.set_node_content(node_id, draft)

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
            "awaiting_user": stay_topo,
            "copy_revise_only": False,
            "pending_orchestrate": False,
            "messages": [AIMessage(content="已将确认的主文案写入画布节点。可继续改拓扑或回复「确认出图」。")],
        }

    return write_copy_node
