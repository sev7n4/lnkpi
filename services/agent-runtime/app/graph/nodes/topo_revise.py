"""Heuristic topology revise at await_topo: query/add/update/remove + Mermaid refresh."""

from __future__ import annotations

import re
from typing import Any, Callable, Literal

from langchain_core.messages import AIMessage

from app.graph.mermaid_topo import manifest_to_mermaid

TopoOp = Literal["query", "remove", "add", "update", "unknown"]

_REMOVE_PREFIXES = ("删掉", "删除", "去掉", "移除")
_ADD_PREFIXES = ("增加", "加上", "补一个", "补一张", "再加")
_QUERY_PREFIXES = ("查看", "查询", "看一下")
_UPDATE_PATTERNS = (
    re.compile(r"把(.+?)(?:改为|改成|换成)(.+)"),
    re.compile(r"(?:调整|修改)(.+)"),
)


def _parse_topo_op(text: str) -> TopoOp:
    t = text.strip()
    if not t:
        return "unknown"
    lowered = t.lower()
    if any(h in t for h in _QUERY_PREFIXES) or "prompt" in lowered:
        return "query"
    if any(p in t for p in _REMOVE_PREFIXES):
        return "remove"
    if any(p in t for p in _ADD_PREFIXES):
        return "add"
    if any(h in t for h in ("改为", "改成", "调整", "换成", "修改")):
        return "update"
    return "unknown"


def _strip_target(raw: str) -> str:
    return raw.strip().strip("「」\"' 。.")


def _find_manifest_item(manifest: list[dict[str, Any]], target: str) -> dict[str, Any] | None:
    target = _strip_target(target)
    if not target:
        return None
    for it in manifest:
        title = str(it.get("title") or "")
        key = str(it.get("key") or "")
        if target in title or target == key or target.lower() == key.lower():
            return it
    return None


def _removed_node_ids(
    before: list[dict[str, Any]], after: list[dict[str, Any]]
) -> list[str]:
    after_keys = {str(it.get("key")) for it in after if it.get("key")}
    ids: list[str] = []
    for it in before:
        key = str(it.get("key") or "")
        if not key or key in after_keys:
            continue
        node_id = str(it.get("node_id") or "").strip()
        if node_id:
            ids.append(node_id)
    return ids


def _apply_remove(manifest: list[dict[str, Any]], text: str) -> tuple[list[dict[str, Any]], str]:
    t = text.strip()
    target = ""
    for p in _REMOVE_PREFIXES:
        if p in t:
            target = _strip_target(t.split(p, 1)[-1])
            break
    if not target:
        return manifest, "未识别删除目标；请说明例如「删掉 Banner」。"

    next_items: list[dict[str, Any]] = []
    removed = False
    for it in manifest:
        title = str(it.get("title") or "")
        key = str(it.get("key") or "")
        if target in title or target == key or target.lower() == key.lower():
            removed = True
            continue
        item = dict(it)
        item["depends_on"] = [d for d in (it.get("depends_on") or []) if str(d) != key]
        next_items.append(item)

    if not removed:
        return manifest, f"未找到名为「{target}」的节点。"

    removed_keys = {str(it.get("key")) for it in manifest} - {str(it.get("key")) for it in next_items}
    cleaned: list[dict[str, Any]] = []
    for it in next_items:
        item = dict(it)
        item["depends_on"] = [d for d in (it.get("depends_on") or []) if str(d) not in removed_keys]
        cleaned.append(item)
    return cleaned, f"已从拓扑移除「{target}」。"


def _parse_add_title(text: str) -> str:
    for p in _ADD_PREFIXES:
        if p in text:
            return _strip_target(text.split(p, 1)[-1])
    return ""


def _parse_update(text: str) -> tuple[str, str] | None:
    for pat in _UPDATE_PATTERNS:
        m = pat.search(text.strip())
        if m:
            if len(m.groups()) == 2:
                return _strip_target(m.group(1)), _strip_target(m.group(2))
            return _strip_target(m.group(1)), _strip_target(m.group(1))
    return None


def _parse_query_target(text: str) -> str:
    t = text.strip()
    for p in _QUERY_PREFIXES:
        if p in t:
            return _strip_target(t.split(p, 1)[-1].replace("节点", ""))
    if "prompt" in t.lower():
        for it in t.replace("的prompt", " ").replace("prompt", " ").split():
            if len(it.strip()) >= 2:
                return _strip_target(it)
    return ""


def _slug_key(title: str, manifest: list[dict[str, Any]]) -> str:
    ascii_key = re.sub(r"[^a-zA-Z0-9_]+", "_", title).strip("_").lower()
    base = ascii_key[:24] if ascii_key else f"added_{len(manifest) + 1}"
    keys = {str(it.get("key")) for it in manifest if it.get("key")}
    if base not in keys:
        return base
    idx = 2
    while f"{base}_{idx}" in keys:
        idx += 1
    return f"{base}_{idx}"


def _format_node_query(item: dict[str, Any], node: dict[str, Any]) -> str:
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    prompt = str(data.get("prompt") or data.get("content") or item.get("prompt_hint") or "")
    title = str(item.get("title") or item.get("key") or "")
    key = str(item.get("key") or "")
    node_id = str(item.get("node_id") or node.get("id") or "")
    lines = [
        f"节点「{title}」",
        f"- key: {key}",
        f"- node_id: {node_id}",
        f"- target_type: {item.get('target_type') or 'image'}",
    ]
    if prompt:
        lines.append(f"- prompt: {prompt[:500]}")
    deps = item.get("depends_on") or []
    if deps:
        lines.append(f"- depends_on: {', '.join(str(d) for d in deps)}")
    return "\n".join(lines)


async def _apply_add(
    nest: Any,
    state: dict[str, Any],
    manifest: list[dict[str, Any]],
    title: str,
) -> tuple[list[dict[str, Any]], str]:
    if not title:
        return manifest, "未识别要增加的节点名称；请说明例如「增加场景图」。"
    key = _slug_key(title, manifest)
    add_fn = getattr(nest, "add_nodes_batch", None)
    connect_fn = getattr(nest, "connect_nodes", None)
    if add_fn is None:
        return manifest, "画布新增 API 不可用。"

    batch_item = {
        "key": key,
        "title": title,
        "targetType": "image",
        "prompt": title,
    }
    batch = await add_fn([batch_item], stage=True)
    node_id = ""
    for n in batch.get("nodes") or []:
        if str(n.get("key") or "") == key:
            node_id = str(n.get("nodeId") or "")
            break
    if not node_id:
        return manifest, f"新增节点「{title}」失败，未返回 nodeId。"

    plan_node_id = str(state.get("plan_node_id") or "").strip()
    if connect_fn is not None and plan_node_id:
        await connect_fn([{"source": plan_node_id, "target": node_id}], stage=True)

    new_item = {
        "key": key,
        "title": title,
        "target_type": "image",
        "prompt_hint": title,
        "depends_on": [],
        "node_id": node_id,
    }
    return manifest + [new_item], f"已新增节点「{title}」（key={key}）。"


async def _apply_update(
    nest: Any,
    manifest: list[dict[str, Any]],
    target: str,
    new_value: str,
) -> tuple[list[dict[str, Any]], str]:
    item = _find_manifest_item(manifest, target)
    if item is None:
        return manifest, f"未找到名为「{target}」的节点。"
    node_id = str(item.get("node_id") or "").strip()
    set_fn = getattr(nest, "set_node_prompt", None)
    if not node_id or set_fn is None:
        return manifest, f"「{target}」尚未绑定画布 node_id，无法更新。"

    await set_fn(node_id, new_value, title=new_value, stage=True)
    updated = [dict(it) for it in manifest]
    for it in updated:
        if str(it.get("key")) == str(item.get("key")):
            it["title"] = new_value
            it["prompt_hint"] = new_value
            break
    return updated, f"已更新节点「{target}」为「{new_value}」。"


async def _apply_query(
    nest: Any,
    manifest: list[dict[str, Any]],
    target: str,
) -> tuple[list[dict[str, Any]], str]:
    if not target:
        return manifest, "请说明要查询的节点，例如「查看主图」。"
    item = _find_manifest_item(manifest, target)
    if item is None:
        return manifest, f"未找到名为「{target}」的节点。"
    node_id = str(item.get("node_id") or "").strip()
    get_fn = getattr(nest, "get_node", None)
    if not node_id or get_fn is None:
        title = str(item.get("title") or item.get("key") or target)
        hint = str(item.get("prompt_hint") or "")
        body = f"节点「{title}」（manifest 缓存）\n- prompt_hint: {hint or '(空)'}"
        return manifest, body
    node = await get_fn(node_id)
    return manifest, _format_node_query(item, node)


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
        op = _parse_topo_op(text)
        new_manifest = manifest
        note = "未识别具体改动；请说明例如「删掉 Banner」「增加场景图」「把主图改为运动风」或「查看主图」。"

        if op == "remove":
            new_manifest, note = _apply_remove(manifest, text)
            if new_manifest != manifest:
                remove_fn = getattr(nest, "remove_nodes", None)
                node_ids = _removed_node_ids(manifest, new_manifest)
                if node_ids and remove_fn is not None:
                    await remove_fn(node_ids, stage=True)
        elif op == "add":
            new_manifest, note = await _apply_add(nest, state, manifest, _parse_add_title(text))
        elif op == "update":
            parsed = _parse_update(text)
            if parsed:
                new_manifest, note = await _apply_update(nest, manifest, parsed[0], parsed[1])
        elif op == "query":
            new_manifest, note = await _apply_query(nest, manifest, _parse_query_target(text))

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

        if op == "query":
            body = note
        else:
            mermaid = manifest_to_mermaid(new_manifest)
            body = f"{note}\n\n当前资产拓扑：\n{mermaid}\n\n确认无误后回复「确认出图」。"
        emit = getattr(nest, "emit_text", None)
        if emit is not None:
            await emit(body)

        return {
            "phase": "await_topo",
            "split_manifest": new_manifest,
            "user_decision": "none",
            "messages": [AIMessage(content=body)],
        }

    return topo_revise
