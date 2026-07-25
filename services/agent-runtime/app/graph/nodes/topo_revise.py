"""Heuristic topology revise: add/remove template keys and refresh Mermaid."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage

from app.graph.mermaid_topo import manifest_to_mermaid


def _apply_heuristic(manifest: list[dict[str, Any]], text: str) -> tuple[list[dict[str, Any]], str]:
    """Return (new_manifest, note). Supports 删掉/去掉 {title|key}."""
    t = text.strip()
    remove_prefixes = ("删掉", "删除", "去掉", "移除")
    target = ""
    for p in remove_prefixes:
        if p in t:
            target = t.split(p, 1)[-1].strip().strip("「」\"' 。.")
            break
    if not target:
        return manifest, "未识别具体改动；请说明例如「删掉 Banner」。"

    next_items: list[dict[str, Any]] = []
    removed = False
    for it in manifest:
        title = str(it.get("title") or "")
        key = str(it.get("key") or "")
        if target in title or target == key or target.lower() == key.lower():
            removed = True
            continue
        deps = [d for d in (it.get("depends_on") or []) if str(d) != key]
        item = dict(it)
        item["depends_on"] = deps
        next_items.append(item)

    if not removed:
        return manifest, f"未找到名为「{target}」的节点。"

    removed_keys = {str(it.get("key")) for it in manifest} - {str(it.get("key")) for it in next_items}
    cleaned: list[dict[str, Any]] = []
    for it in next_items:
        deps = [d for d in (it.get("depends_on") or []) if str(d) not in removed_keys]
        item = dict(it)
        item["depends_on"] = deps
        cleaned.append(item)
    return cleaned, f"已从拓扑移除「{target}」。"


def make_topo_revise_node(*, nest: Any) -> Callable:
    async def topo_revise(state: dict) -> dict:
        text = ""
        for msg in reversed(state.get("messages") or []):
            role = getattr(msg, "type", None) or (msg.get("role") if isinstance(msg, dict) else None)
            content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")
            if role in ("human", "user") and content:
                text = str(content)
                break

        manifest = [dict(x) for x in (state.get("split_manifest") or []) if isinstance(x, dict)]
        new_manifest, note = _apply_heuristic(manifest, text)

        emit_list = getattr(nest, "emit_task_list", None)
        if emit_list is not None and new_manifest != manifest:
            await emit_list(
                [
                    {
                        "id": str(item["key"]),
                        "title": str(item.get("title") or item["key"]),
                        "nodeId": str(item.get("node_id") or ""),
                        "kind": str(item.get("target_type") or "image"),
                    }
                    for item in new_manifest
                    if item.get("key")
                ]
            )

        mermaid = manifest_to_mermaid(new_manifest)
        body = f"{note}\n\n当前资产拓扑：\n{mermaid}\n\n确认无误后回复「确认出图」。"
        emit = getattr(nest, "emit_text", None)
        if emit is not None:
            await emit(body)

        return {
            "phase": "await_topo",
            "awaiting_user": True,
            "split_manifest": new_manifest,
            "user_decision": "none",
            "messages": [AIMessage(content=body)],
        }

    return topo_revise
