from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.state import SplitManifestItem
from app.graph.canvas_stage import rollback_stage_safe, stage_failure_message
from app.graph.chain_refs import build_chain_ref_order
from app.graph.copy_sot import snapshot_copy_sot_fields
from app.graph.mermaid_topo import manifest_to_mermaid
from app.graph.topo import precompute_gen_order
from app.graph.topo_trim import trim_manifest_items
from app.skills.loader import discover_skills, load_skill


def _gen_order_fields(manifest: list[dict[str, Any]]) -> dict[str, Any]:
    """W13: pre-sort auto-generate keys at split; detect cycles before await_topo."""
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


def _manifest_items(canvas_manifest: dict | None, max_downstream: int) -> list[SplitManifestItem]:
    if not canvas_manifest or not isinstance(canvas_manifest.get("items"), list):
        return []

    items: list[SplitManifestItem] = []
    for raw in canvas_manifest["items"][:max_downstream]:
        if not isinstance(raw, dict) or not raw.get("key"):
            continue
        target = str(raw.get("target_type") or "image")
        if target not in ("text", "image", "video"):
            target = "image"
        hint = str(raw.get("prompt_hint_template") or raw.get("prompt_hint") or "")
        chain = raw.get("chain") if raw.get("chain") in ("product", "model") else None
        role = (
            raw.get("role")
            if raw.get("role") in ("seed", "turnaround", "downstream")
            else None
        )
        items.append(
            SplitManifestItem(
                key=str(raw["key"]),
                title=str(raw.get("title") or raw["key"]),
                target_type=target,  # type: ignore[arg-type]
                source_section=str(raw.get("source_section") or ""),
                gen_mode=raw.get("gen_mode"),
                auto_generate=bool(raw.get("auto_generate", target == "image")),
                depends_on=[str(d) for d in (raw.get("depends_on") or [])],
                prompt_hint=hint,
                node_id=None,
                chain=chain,  # type: ignore[arg-type]
                role=role,  # type: ignore[arg-type]
            )
        )
    return items


def _resolve_topology_mode(skill: Any, canvas_manifest: dict | None) -> str:
    """Resolve full vs trimmed from skill metadata / manifest defaults (not checkpoint)."""
    meta = getattr(skill, "metadata", None) or {}
    if isinstance(meta, dict):
        m = str(meta.get("lnkpi.topology_mode_default") or "").strip().lower()
        if m in ("full", "trimmed"):
            return m
    if isinstance(canvas_manifest, dict):
        defaults = canvas_manifest.get("defaults") or {}
        m = str(defaults.get("topology_mode_default") or "").strip().lower()
        if m in ("full", "trimmed"):
            return m
    return "full"


def _select_trimmed_keys(plan_summary: str, items: list[SplitManifestItem]) -> list[str]:
    """Heuristic trim: keep copy + product turnaround core; omit full model chain by default."""
    keys = [str(i["key"]) for i in items]
    must = [
        k
        for k in (
            "copy_main",
            "white_bg",
            "product_turnaround",
            "hero_main",
            "detail_cut",
            "video_product",
        )
        if k in keys
    ]
    if len(plan_summary or "") > 80:
        for k in ("scene", "banner"):
            if k in keys and k not in must:
                must.append(k)
    return must or keys[: max(3, min(5, len(keys)))]


async def _apply_modify_split(nest: Any, state: dict, plan_node_id: str) -> dict:
    """P0 修复：modify 模式下按 node_operations（rename/add/delete）增量更新画布节点。
    - rename: set_node_prompt 更新已有节点的 prompt + title
    - add: add_nodes_batch 创建 + connect_nodes 接边
    - delete: 当前无 delete API，跳过（仅从 split_manifest 移除标记）
    - node_operations 为 None（LLM 解析失败）：仅更新方案节点，节点清单不变，回拓扑门
    """
    old_manifest = list(state.get("split_manifest") or [])
    old_by_key: dict[str, dict] = {
        str(it.get("key")): it for it in old_manifest if it.get("key")
    }
    # 复制一份 split_manifest 作为更新基底
    updated: list[dict] = [dict(it) for it in old_manifest]
    key_to_id: dict[str, str] = {
        str(it.get("key")): str(it.get("node_id") or "")
        for it in updated
        if it.get("key")
    }
    ops = state.get("node_operations")

    # node_operations 为 None（LLM 解析失败）：不改动节点，直接回拓扑确认门
    if not ops:
        base = {
            "phase": "await_topo",
            "mode": "modify",
            "split_manifest": old_manifest,
            "messages": [
                AIMessage(
                    content=(
                        "方案已更新并写入画布。节点结构未识别到变化，沿用原拓扑。"
                        "请预览后回复「确认出图」；如需继续调整请说明。"
                    )
                )
            ],
        }
        base.update(_gen_order_fields(old_manifest))
        return base

    renamed_keys: list[str] = []
    added_keys: list[str] = []
    new_items_for_batch: list[dict] = []
    new_items_meta: list[dict] = []

    try:
        for op in ops:
            if not isinstance(op, dict):
                continue
            kind = str(op.get("op") or "").lower()
            key = str(op.get("key") or "")
            if not key:
                continue
            if kind == "rename":
                old = old_by_key.get(key)
                node_id = str(old.get("node_id") or "") if old else ""
                if not node_id:
                    continue
                title = str(op.get("title") or key)
                prompt_hint = str(op.get("prompt_hint") or "")
                await nest.set_node_prompt(node_id, prompt_hint, title=title, stage=True)
                for it in updated:
                    if str(it.get("key")) == key:
                        it["title"] = title
                        it["prompt_hint"] = prompt_hint
                        break
                renamed_keys.append(key)
            elif kind == "add":
                new_items_for_batch.append(
                    {
                        "key": key,
                        "title": str(op.get("title") or key),
                        "targetType": str(op.get("target_type") or "image"),
                        "prompt": str(op.get("prompt_hint") or ""),
                    }
                )
                new_items_meta.append(op)
                added_keys.append(key)

        if new_items_for_batch:
            batch = await nest.add_nodes_batch(new_items_for_batch, stage=True)
            for n in batch.get("nodes") or []:
                k = str(n.get("key") or "")
                nid = str(n.get("nodeId") or "")
                if k and nid:
                    key_to_id[k] = nid
                    meta = next((m for m in new_items_meta if str(m.get("key")) == k), {})
                    updated.append(
                        {
                            "key": k,
                            "title": str(meta.get("title") or k),
                            "target_type": str(meta.get("target_type") or "image"),
                            "prompt_hint": str(meta.get("prompt_hint") or ""),
                            "depends_on": list(meta.get("depends_on") or []),
                            "node_id": nid,
                        }
                    )

        edges: list[dict[str, str]] = []
        for meta in new_items_meta:
            k = str(meta.get("key") or "")
            nid = key_to_id.get(k)
            if not nid:
                continue
            edges.append({"source": plan_node_id, "target": nid})
            for dep_key in meta.get("depends_on") or []:
                dep_id = key_to_id.get(str(dep_key))
                if dep_id and dep_id != nid:
                    edges.append({"source": dep_id, "target": nid})
        if edges:
            await nest.connect_nodes(edges, stage=True)
    except Exception as exc:  # noqa: BLE001
        await rollback_stage_safe(nest)
        return {
            "phase": "error",
            "last_error": str(exc),
            "mode": "modify",
            "split_manifest": old_manifest,
            "messages": [AIMessage(content=stage_failure_message("拓扑更新", exc))],
        }

    parts = []
    if renamed_keys:
        parts.append(f"改名 {len(renamed_keys)} 个节点")
    if added_keys:
        parts.append(f"新增 {len(added_keys)} 个节点：{'、'.join(added_keys)}")
    msg = (
        "已更新画布拓扑：" + ("；".join(parts) if parts else "无结构变化") +
        "\n\n请预览拓扑后回复「确认出图」；如需继续调整请说明。"
    )
    emit_list = getattr(nest, "emit_task_list", None)
    if emit_list is not None:
        try:
            await emit_list(
                [
                    {
                        "id": str(it.get("key")),
                        "title": str(it.get("title") or it.get("key")),
                        "nodeId": str(it.get("node_id") or ""),
                        "kind": str(it.get("target_type") or "image"),
                    }
                    for it in updated
                    if it.get("key")
                ]
            )
        except Exception:  # noqa: BLE001
            pass

    out = {
        "phase": "await_topo",
        "mode": "modify",
        "split_manifest": updated,
        "node_operations": None,
        "messages": [AIMessage(content=msg)],
    }
    order_fields = _gen_order_fields(updated)
    if order_fields.get("phase") == "error":
        await rollback_stage_safe(nest)
        return {
            **order_fields,
            "mode": "modify",
            "split_manifest": old_manifest,
        }
    out.update(order_fields)
    return out


def make_split_node(*, nest: Any, skills_dir: Path) -> Callable:
    async def split(state: dict) -> dict:
        plan_node_id = state.get("plan_node_id")
        if not plan_node_id:
            raise RuntimeError("plan_node_id required before split")

        await nest.get_node(plan_node_id)

        # P0 修复：modify 模式（node_revise）upsert 现有节点 + 新增节点，而非用 skill 模板重建
        if state.get("mode") == "modify":
            return await _apply_modify_split(nest, state, plan_node_id)

        skill_id = state.get("skill_id")
        if not skill_id:
            raise RuntimeError("skill_id missing for split")
        entries = {e.skill_id: e for e in discover_skills(skills_dir)}
        skill = load_skill(entries[skill_id])
        mode = _resolve_topology_mode(skill, skill.canvas_manifest)
        manifest = _manifest_items(skill.canvas_manifest, skill.max_downstream)
        if mode == "trimmed" and manifest:
            selected = _select_trimmed_keys(str(state.get("plan_summary") or ""), manifest)
            trimmed = trim_manifest_items([dict(it) for it in manifest], selected)
            manifest = [
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
                    role=(
                        it.get("role")
                        if it.get("role") in ("seed", "turnaround", "downstream")
                        else None
                    ),  # type: ignore[arg-type]
                )
                for it in trimmed
                if it.get("key")
            ]
        if not manifest:
            return {
                "phase": "split",
                "split_manifest": [],
                "messages": [AIMessage(content="当前 Skill 无 canvas-manifest，跳过批量拆解。")],
            }

        batch_items = [
            {
                "key": item["key"],
                "title": item["title"],
                "targetType": item["target_type"],
                "prompt": item.get("prompt_hint") or "",
            }
            for item in manifest
        ]
        batch = await nest.add_nodes_batch(batch_items)
        key_to_id = {n["key"]: n["nodeId"] for n in batch.get("nodes") or []}

        for item in manifest:
            item["node_id"] = key_to_id.get(item["key"])

        edges: list[dict[str, str]] = []
        for item in manifest:
            nid = item.get("node_id")
            if not nid:
                continue
            edges.append({"source": plan_node_id, "target": nid})
            for dep_key in item.get("depends_on") or []:
                dep_id = key_to_id.get(dep_key)
                if dep_id:
                    edges.append({"source": dep_id, "target": nid})

        if edges:
            await nest.connect_nodes(edges)

        by_key = {str(i["key"]): dict(i) for i in manifest if i.get("key")}
        for item in manifest:
            nid = item.get("node_id")
            if not nid:
                continue
            hint = item.get("prompt_hint") or ""
            if hint:
                await nest.set_node_prompt(nid, hint)
            ref_order = build_chain_ref_order(
                item=dict(item), by_key=by_key, plan_node_id=plan_node_id
            )
            await nest.attach_refs(nid, ref_order)

        titles = [str(i.get("title") or i.get("key") or "") for i in manifest]
        title_hint = "、".join(t for t in titles if t)[:80]
        mermaid = manifest_to_mermaid(list(manifest))
        mode_label = "全量模板" if mode == "full" else "按方案精简"
        split_msg = (
            f"已按方案拆解 {len(manifest)} 个画布节点骨架（{mode_label}）"
            + (f"：{title_hint}" if title_hint else "。")
            + "\n先预览拓扑，确认出图前不会自动生成。\n\n"
            + f"当前资产拓扑：\n{mermaid}\n\n"
            + "可自然语言改拓扑，或确认主文案；准备好后回复「确认出图」。"
        )
        emit_list = getattr(nest, "emit_task_list", None)
        if emit_list is not None:
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
        out = {
            "phase": "split",
            "split_manifest": manifest,
            "messages": [AIMessage(content=split_msg)],
            **snapshot_copy_sot_fields(state),
        }
        out.update(_gen_order_fields(list(manifest)))
        return out

    return split
