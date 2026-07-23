from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.state import SplitManifestItem
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


def make_split_node(*, nest: Any, skills_dir: Path) -> Callable:
    async def split(state: dict) -> dict:
        plan_node_id = state.get("plan_node_id")
        if not plan_node_id:
            raise RuntimeError("plan_node_id required before split")

        # Read plan from Nest (canonical store); do not keep full canvas in state
        await nest.get_node(plan_node_id)

        skill_id = state.get("skill_id")
        if not skill_id:
            raise RuntimeError("skill_id missing for split")
        entries = {e.skill_id: e for e in discover_skills(skills_dir)}
        skill = load_skill(entries[skill_id])
        manifest = _manifest_items(skill.canvas_manifest, skill.max_downstream)
        if not manifest:
            return {
                "phase": "split",
                "split_manifest": [],
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
        return {
            "phase": "split",
            "split_manifest": manifest,
            "focus_node_ids": focus,
            "awaiting_user": False,
            "messages": [
                AIMessage(
                    content=f"已按方案拆解 {len(manifest)} 个画布节点骨架（含 white_bg / hero_main 等）。"
                )
            ],
        }

    return split
