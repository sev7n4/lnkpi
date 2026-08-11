"""Start generation: compute topological order + dependency graph, init W3 state.

Writes the Send-API generation fields consumed by ``gen_scheduler`` /
``gen_node`` / ``collect_gen``. The reducer-backed accumulators
(``gen_*_keys`` / ``gen_fail_details``) are reset to ``None`` here so a
re-generation on the same thread does not leak the previous run's keys.
"""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.canvas_sync import reconcile_manifest_from_canvas
from app.graph.canvas_stage import commit_stage_or_rollback
from app.graph.gen_run_state import reset_tier_b_reducers_for_new_run
from app.graph.hitl_resume import GATE_DECISION_CLEAR
from app.graph.product_visual_copy import ProductVisualCopy
from app.graph.product_visual_v2.presentation import build_presentation_envelope
from app.graph.task_events import build_task_list_items
from app.graph.topo import topo_sort_gen_keys


def make_start_gen_node(*, nest: Any = None) -> Callable:
    """Create start_gen node."""

    async def start_gen(state: dict) -> dict:
        ok, commit_err = await commit_stage_or_rollback(nest)
        if not ok:
            return {
                "phase": "await_topo",
                "last_error": commit_err,
                "messages": [
                    AIMessage(
                        content=(
                            f"画布提交失败，已回滚暂存变更：{commit_err}。"
                            "请重试「确认出图」。"
                        )
                    )
                ],
            }

        manifest = list(state.get("split_manifest") or [])
        sync_note = ""
        summary_fn = getattr(nest, "get_canvas_summary", None) if nest is not None else None
        if summary_fn is not None and manifest:
            try:
                summary = await summary_fn()
                manifest, sync_note = reconcile_manifest_from_canvas(
                    manifest,
                    summary.get("nodes") or [],
                    plan_node_id=str(state.get("plan_node_id") or ""),
                )
            except Exception:  # noqa: BLE001
                pass

        if not manifest:
            return {
                "phase": "done",
                "messages": [AIMessage(content="无可自动生成的图片/视频节点。")],
            }

        by_key = {str(it["key"]): it for it in manifest if it.get("key")}

        ordered_keys = list(state.get("gen_ordered_keys") or [])
        if sync_note:
            ordered_keys = []
        if not ordered_keys:
            try:
                ordered_keys = topo_sort_gen_keys(manifest)
            except ValueError as exc:
                return {
                    "phase": "done",
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"出图编排失败：{exc}")],
                }

        regen_keys = set(ordered_keys)
        prev_by_key = state.get("gen_by_key") or {}
        if isinstance(prev_by_key, dict):
            for k, item in by_key.items():
                if k in regen_keys:
                    continue
                prev = prev_by_key.get(k)
                if not isinstance(prev, dict):
                    continue
                merged = dict(item)
                for field in ("url", "generationRecordId", "status"):
                    if prev.get(field):
                        merged[field] = prev[field]
                by_key[k] = merged

        if not ordered_keys:
            return {
                "phase": "done",
                "messages": [AIMessage(content="无可自动生成的图片/视频节点。")],
            }

        key_set = set(ordered_keys)
        deps_of = {
            k: [str(d) for d in (by_key[k].get("depends_on") or []) if str(d) in key_set]
            for k in ordered_keys
        }

        msg = f"开始按拓扑出图，共 {len(ordered_keys)} 个节点…"
        if sync_note:
            msg = f"{sync_note}\n{msg}"

        task_items = build_task_list_items(manifest, ordered_keys)
        emit_list = getattr(nest, "emit_task_list", None) if nest is not None else None
        presentation: dict | None = None
        pv_v2 = bool(state.get("product_visual_scheme_v2"))
        if pv_v2 or state.get("flow_mode") == "product_visual":
            try:
                copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
                presentation = build_presentation_envelope(
                    kind="task_progress_card",
                    phase="start_gen",
                    state={**state, "split_manifest": manifest},
                    copy=copy,
                )
            except Exception:  # noqa: BLE001
                presentation = None

        if emit_list is not None and task_items:
            meta: dict[str, str] = {}
            if presentation:
                banner = str((presentation.get("body") or {}).get("banner") or "")
                if banner:
                    meta["banner"] = banner
            try:
                await emit_list(task_items, **meta)
            except Exception:  # noqa: BLE001
                pass

        out: dict = {
            "split_manifest": manifest,
            "gen_ordered_keys": ordered_keys,
            "gen_deps_of": deps_of,
            "gen_by_key": by_key,
            **reset_tier_b_reducers_for_new_run(),
            **GATE_DECISION_CLEAR,
            "messages": [AIMessage(content=msg)],
        }
        if presentation is not None:
            out["presentation"] = presentation
        return out

    return start_gen
