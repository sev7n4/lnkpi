"""Phase 3 product_visual dynamic split — plan → manifest items (Task 5)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.chain_refs import build_chain_ref_order
from app.graph.mermaid_topo import manifest_to_mermaid
from app.graph.phase1_seed import PHASE1_ASSET_KEYS, PHASE1_MANIFEST_TEMPLATE
from app.graph.product_visual_prompt import build_scheme_prompt_hint
from app.graph.state import SplitManifestItem
from app.graph.topo import precompute_gen_order

PHASE1_DEPENDS = ["white_bg", "product_turnaround"]


def _selected_scheme_ids(image_type: dict[str, Any]) -> list[str]:
    selected = image_type.get("selected_scheme_ids") or []
    if selected:
        return [str(s).strip() for s in selected if str(s).strip()]
    schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
    recommended = [str(s["scheme_id"]) for s in schemes if s.get("recommended")]
    if recommended:
        return recommended
    return [str(s["scheme_id"]) for s in schemes if s.get("scheme_id")]


def build_manifest_from_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Build downstream manifest items from product_visual_plan (excludes Phase 1 seed)."""
    visual_intent = plan.get("visual_intent") if isinstance(plan.get("visual_intent"), dict) else {}
    items: list[dict[str, Any]] = []
    for image_type in plan.get("image_types") or []:
        if not isinstance(image_type, dict):
            continue
        type_id = str(image_type.get("type_id") or "").strip()
        type_label = str(image_type.get("type_label") or type_id).strip()
        if not type_id:
            continue
        schemes = [s for s in (image_type.get("schemes") or []) if isinstance(s, dict)]
        scheme_by_id = {str(s["scheme_id"]): s for s in schemes if s.get("scheme_id")}
        for scheme_id in _selected_scheme_ids(image_type):
            scheme = scheme_by_id.get(scheme_id)
            if not scheme:
                continue
            scheme_name = str(scheme.get("name") or scheme_id).strip()
            items.append(
                {
                    "key": f"{type_id}__{scheme_id}",
                    "title": f"{type_label} · {scheme_name}",
                    "target_type": "image",
                    "chain": "product",
                    "role": "downstream",
                    "auto_generate": True,
                    "depends_on": list(PHASE1_DEPENDS),
                    "prompt_hint": build_scheme_prompt_hint(scheme, visual_intent),
                    "type_id": type_id,
                    "scheme_id": scheme_id,
                    "key_elements": scheme.get("key_elements") or {},
                }
            )
    return items


def _merge_phase1_items(state: dict) -> list[dict[str, Any]]:
    """Merge Phase 1 seed items from checkpoint with template defaults."""
    existing = {
        str(it["key"]): dict(it)
        for it in (state.get("split_manifest") or [])
        if isinstance(it, dict) and str(it.get("key") or "") in PHASE1_ASSET_KEYS
    }
    out: list[dict[str, Any]] = []
    for tmpl in PHASE1_MANIFEST_TEMPLATE:
        key = str(tmpl["key"])
        out.append({**tmpl, **existing[key]} if key in existing else dict(tmpl))
    return out


def _gen_order_fields(manifest: list[dict[str, Any]]) -> dict[str, Any]:
    ordered, err = precompute_gen_order(manifest)
    if err:
        return {
            "last_error": err,
            "gen_ordered_keys": None,
            "phase": "error",
            "messages": [
                AIMessage(
                    content=(
                        f"拓扑依赖有环，无法继续：{err}。"
                        "请调整方案中的节点 depends_on 后重试。"
                    )
                )
            ],
        }
    return {"gen_ordered_keys": ordered}


def _model_ref_node_id(state: dict) -> str | None:
    for att in state.get("sidebar_attachments") or []:
        if not isinstance(att, dict):
            continue
        role = str(att.get("role") or "").lower()
        if role in ("model", "human", "模特"):
            nid = att.get("nodeId") or att.get("node_id")
            if nid:
                return str(nid)
    return None


def _needs_model_ref(item: dict[str, Any], state: dict) -> bool:
    key_elements = item.get("key_elements") or {}
    if not isinstance(key_elements, dict):
        return False
    if key_elements.get("human_presence") and str(key_elements.get("model_source") or "") == "user_ref":
        return True
    return bool(key_elements.get("human_presence") and _model_ref_node_id(state))


async def _ensure_plan_node_id(nest: Any, state: dict, plan: dict[str, Any]) -> str | None:
    existing = str(state.get("plan_node_id") or "").strip()
    if existing:
        return existing
    upsert = getattr(nest, "upsert_prompt_node", None)
    if upsert is None:
        return None
    intent = plan.get("visual_intent") if isinstance(plan.get("visual_intent"), dict) else {}
    goal = str(intent.get("primary_goal") or "product visual").strip()
    content = json.dumps(plan, ensure_ascii=False, indent=2)
    result = await upsert(prompt=f"视觉方案：{goal}", content=content)
    return str(result.get("nodeId") or "").strip() or None


def make_split_product_visual_node(*, nest: Any, skills_dir: Path) -> Callable:
    async def split_product_visual(state: dict) -> dict:
        plan = state.get("product_visual_plan")
        if not isinstance(plan, dict):
            return {
                "phase": "error",
                "last_error": "product_visual_plan_missing",
                "messages": [AIMessage(content="视觉方案缺失，无法拆解画布任务。")],
            }

        phase1_items = _merge_phase1_items(state)
        downstream_items = build_manifest_from_plan(plan)
        if not downstream_items:
            return {
                "phase": "error",
                "last_error": "product_visual_split_empty",
                "messages": [AIMessage(content="未选中任何视觉变体，无法继续出图。")],
            }

        manifest: list[SplitManifestItem] = [
            SplitManifestItem(
                key=str(it["key"]),
                title=str(it.get("title") or it["key"]),
                target_type=it.get("target_type") or "image",  # type: ignore[arg-type]
                source_section=str(it.get("source_section") or ""),
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

        plan_node_id = await _ensure_plan_node_id(nest, state, plan)
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
                    "messages": [AIMessage(content=f"创建画布节点失败：{exc}")],
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
        edges: list[dict[str, str]] = []
        for item in manifest:
            nid = str(item.get("node_id") or "").strip()
            if not nid:
                continue
            if plan_node_id:
                edges.append({"source": plan_node_id, "target": nid})
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

        model_nid = _model_ref_node_id(state)
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
            if model_nid and _needs_model_ref(dict(item), state):
                if model_nid not in ref_order:
                    ref_order.append(model_nid)
            if ref_order:
                await nest.attach_refs(nid, ref_order)

        mermaid = manifest_to_mermaid(list(manifest))
        downstream_count = len(downstream_items)
        split_msg = (
            f"已拆解 {downstream_count} 个视觉出图任务（含 Phase 1 白底与四视图）。"
            "\n先预览拓扑，确认出图前不会自动生成。\n\n"
            f"当前资产拓扑：\n{mermaid}\n\n"
            "准备好后回复「确认出图」。"
        )
        emit_list = getattr(nest, "emit_task_list", None)
        if emit_list is not None:
            try:
                await emit_list(
                    [
                        {
                            "id": str(item["key"]),
                            "title": str(item.get("title") or item["key"]),
                            "nodeId": str(item.get("node_id") or ""),
                            "kind": str(item.get("target_type") or "image"),
                        }
                        for item in manifest
                        if item.get("key")
                    ]
                )
            except Exception:  # noqa: BLE001
                pass

        out: dict[str, Any] = {
            "phase": "await_topo",
            "split_manifest": manifest,
            "messages": [AIMessage(content=split_msg)],
        }
        if plan_node_id:
            out["plan_node_id"] = plan_node_id
        order_fields = _gen_order_fields(list(manifest))
        if order_fields.get("phase") == "error":
            return order_fields
        out.update(order_fields)
        return out

    return split_product_visual
