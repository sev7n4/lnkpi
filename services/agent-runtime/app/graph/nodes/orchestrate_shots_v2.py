"""Phase 3b orchestrate shots — manifest + lazy phase1 + topo (v1.1)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.chain_refs import build_chain_ref_order
from app.graph.mermaid_topo import manifest_to_mermaid
from app.graph.nodes.split_product_visual import _gen_order_fields, _merge_phase1_items
from app.graph.phase1_seed import PHASE1_ASSET_KEYS, ensure_phase1_seed_chain
from app.graph.product_visual_v2.manifest import (
    build_gen_items_from_shots,
    required_phase1_keys,
)
from app.graph.product_visual_v2.synthesize import synthesize_gen_prompt_hint
from app.graph.state import SplitManifestItem


def _synthesized_hints(shots: list[dict], visual_intent: dict | None) -> dict[str, str]:
    hints: dict[str, str] = {}
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        shot_id = str(shot.get("shot_id") or "")
        label = str(shot.get("label") or shot_id)
        type_id = str(shot.get("type_id") or "")
        prose = str(shot.get("shot_prose") or "")
        variants = max(1, min(3, int(shot.get("variant_count") or 1)))
        for v in range(1, variants + 1):
            key = shot_id if variants == 1 else f"{shot_id}__v{v}"
            hints[key] = synthesize_gen_prompt_hint(
                shot_prose=prose,
                shot_label=label,
                type_id=type_id,
                visual_intent=visual_intent,
            )
    return hints


def make_orchestrate_shots_v2_node(*, nest: Any, skills_dir: Path) -> Callable:
    async def orchestrate_shots_v2(state: dict) -> dict:
        shots = state.get("shot_manifest") or []
        if not shots:
            return {
                "phase": "error",
                "last_error": "shot_manifest_missing",
                "messages": [AIMessage(content="构图清单缺失，无法编排出图。")],
            }

        visual_intent = state.get("visual_intent") if isinstance(state.get("visual_intent"), dict) else {}
        hints = _synthesized_hints(shots, visual_intent)
        downstream_items = build_gen_items_from_shots(
            shots, visual_intent=visual_intent, synthesized_hints=hints
        )
        if not downstream_items:
            return {
                "phase": "error",
                "last_error": "orchestrate_empty",
                "messages": [AIMessage(content="未生成任何出图任务。")],
            }

        needed_phase1 = required_phase1_keys(shots)
        phase1_items = _merge_phase1_items(state)
        if needed_phase1:
            subset_template = [it for it in phase1_items if str(it.get("key")) in needed_phase1]
            manifest_seed, err = await ensure_phase1_seed_chain(
                nest, {**state, "split_manifest": subset_template}, run_generation=False
            )
            if err:
                return {**err}
            phase1_items = manifest_seed
            state = {**state, "split_manifest": manifest_seed, "phase1_asset_keys": needed_phase1}
        else:
            phase1_items = []

        manifest: list[SplitManifestItem] = [
            SplitManifestItem(
                key=str(it["key"]),
                title=str(it.get("title") or it["key"]),
                target_type=it.get("target_type") or "image",  # type: ignore[arg-type]
                source_section="",
                gen_mode=it.get("gen_mode"),
                auto_generate=bool(it.get("auto_generate", True)),
                depends_on=[str(d) for d in (it.get("depends_on") or [])],
                prompt_hint=str(it.get("prompt_hint") or ""),
                node_id=it.get("node_id"),
                chain=it.get("chain") if it.get("chain") in ("product", "model") else None,  # type: ignore[arg-type]
                role=it.get("role") if it.get("role") in ("seed", "turnaround", "downstream") else None,  # type: ignore[arg-type]
            )
            for it in [*phase1_items, *downstream_items]
        ]

        plan_node_id = str(state.get("plan_node_id") or "").strip()
        to_create = [it for it in manifest if not str(it.get("node_id") or "").strip()]

        if to_create:
            batch_items = [
                {
                    "key": item["key"],
                    "title": item["title"],
                    "targetType": item["target_type"],
                    "prompt": item.get("prompt_hint") or "",
                }
                for item in to_create
            ]
            try:
                batch = await nest.add_nodes_batch(batch_items)
            except Exception as exc:  # noqa: BLE001
                return {
                    "phase": "error",
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"创建出图节点失败：{exc}")],
                }
            key_to_id = {
                str(n.get("key") or ""): str(n.get("nodeId") or "").strip()
                for n in (batch.get("nodes") or [])
                if isinstance(n, dict)
            }
            for item in manifest:
                if not item.get("node_id"):
                    item["node_id"] = key_to_id.get(str(item["key"]))

        by_key = {str(i["key"]): dict(i) for i in manifest if i.get("key")}
        shot_node_ids = {
            str(s.get("shot_id") or ""): str(s.get("node_id") or "")
            for s in shots
            if isinstance(s, dict)
        }
        edges: list[dict[str, str]] = []
        for item in manifest:
            nid = str(item.get("node_id") or "").strip()
            if not nid:
                continue
            if plan_node_id:
                edges.append({"source": plan_node_id, "target": nid})
            shot_nid = shot_node_ids.get(str(item.get("shot_id") or ""))
            if shot_nid:
                edges.append({"source": shot_nid, "target": nid})
            for dep_key in item.get("depends_on") or []:
                dep_id = str(by_key.get(str(dep_key), {}).get("node_id") or "").strip()
                if dep_id and dep_id != nid:
                    edges.append({"source": dep_id, "target": nid})

        if edges:
            try:
                await nest.connect_nodes(edges)
            except Exception as exc:  # noqa: BLE001
                return {
                    "phase": "error",
                    "last_error": str(exc),
                    "messages": [AIMessage(content=f"连接画布节点失败：{exc}")],
                }

        for item in manifest:
            nid = str(item.get("node_id") or "").strip()
            if not nid:
                continue
            hint = str(item.get("prompt_hint") or "").strip()
            if hint:
                await nest.set_node_prompt(nid, hint)
            ref_order = build_chain_ref_order(
                item=dict(item), by_key=by_key, plan_node_id=plan_node_id
            )
            shot_nid = shot_node_ids.get(str(item.get("shot_id") or ""))
            if shot_nid and shot_nid not in ref_order:
                ref_order.insert(0, shot_nid)
            if ref_order:
                await nest.attach_refs(nid, ref_order)

        mermaid = manifest_to_mermaid(list(manifest))
        phase1_note = f"（Phase1: {', '.join(needed_phase1)}）" if needed_phase1 else ""
        split_msg = (
            f"已编排 {len(downstream_items)} 个视觉出图任务{phase1_note}。"
            "\n先预览拓扑，确认出图前不会自动生成。\n\n"
            f"当前资产拓扑：\n{mermaid}\n\n"
            "准备好后回复「确认出图」。"
        )

        out: dict[str, Any] = {
            "phase": "await_topo",
            "split_manifest": manifest,
            "phase1_asset_keys": needed_phase1 or None,
            "messages": [AIMessage(content=split_msg)],
        }
        order_fields = _gen_order_fields(list(manifest))
        if order_fields.get("phase") == "error":
            return order_fields
        out.update(order_fields)
        return out

    return orchestrate_shots_v2
