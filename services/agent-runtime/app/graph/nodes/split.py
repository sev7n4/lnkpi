from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.state import SplitManifestItem
from app.graph.mermaid_topo import manifest_to_mermaid
from app.graph.topo_trim import trim_manifest_items
from app.skills.loader import discover_skills, load_skill


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
            )
        )
    return items


def _resolve_topology_mode(state: dict, skill: Any, canvas_manifest: dict | None) -> str:
    mode = state.get("topology_mode")
    if mode in ("full", "trimmed"):
        return mode
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
    """Heuristic trim: always keep copy + white_bg + hero; drop brand/model/banner if summary short."""
    keys = [str(i["key"]) for i in items]
    must = [k for k in ("copy_main", "white_bg", "hero_main", "detail_cut", "show_video") if k in keys]
    if len(plan_summary or "") > 80:
        for k in ("scene", "banner"):
            if k in keys and k not in must:
                must.append(k)
    return must or keys[: max(3, min(5, len(keys)))]


def make_split_node(*, nest: Any, skills_dir: Path) -> Callable:
    async def split(state: dict) -> dict:
        plan_node_id = state.get("plan_node_id")
        if not plan_node_id:
            raise RuntimeError("plan_node_id required before split")

        await nest.get_node(plan_node_id)

        skill_id = state.get("skill_id")
        if not skill_id:
            raise RuntimeError("skill_id missing for split")
        entries = {e.skill_id: e for e in discover_skills(skills_dir)}
        skill = load_skill(entries[skill_id])
        mode = _resolve_topology_mode(state, skill, skill.canvas_manifest)
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
                )
                for it in trimmed
                if it.get("key")
            ]
        if not manifest:
            return {
                "phase": "split",
                "split_manifest": [],
                "topology_mode": mode,
                "awaiting_user": False,
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

        for item in manifest:
            nid = item.get("node_id")
            if not nid:
                continue
            hint = item.get("prompt_hint") or ""
            if hint:
                await nest.set_node_prompt(nid, hint)
            ref_order = [plan_node_id]
            for dep_key in item.get("depends_on") or []:
                dep_id = key_to_id.get(dep_key)
                if dep_id and dep_id not in ref_order:
                    ref_order.append(dep_id)
            await nest.attach_refs(nid, ref_order)

        focus = [i["node_id"] for i in manifest if i.get("node_id")]
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
        return {
            "phase": "split",
            "split_manifest": manifest,
            "topology_mode": mode,
            "focus_node_ids": focus,
            "awaiting_user": False,
            "pending_orchestrate": False,
            "messages": [AIMessage(content=split_msg)],
        }

    return split
