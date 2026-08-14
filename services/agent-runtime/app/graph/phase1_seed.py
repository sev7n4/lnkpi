"""Phase 1 product_visual seed chain — white_bg → product_turnaround."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from app.graph.chain_refs import build_chain_ref_order

PHASE1_ASSET_KEYS = ["white_bg", "product_turnaround"]

PHASE1_MANIFEST_TEMPLATE: list[dict[str, Any]] = [
    {
        "key": "white_bg",
        "title": "白底主图",
        "target_type": "image",
        "chain": "product",
        "role": "seed",
        "auto_generate": True,
        "depends_on": [],
        "prompt_hint": (
            "产品白底主图，居中，商业摄影，干净纯白背景，同一 SKU 外观清晰可见…"
        ),
        "gen_mode": "t2i",
    },
    {
        "key": "product_turnaround",
        "title": "产品四视图",
        "target_type": "image",
        "chain": "product",
        "role": "turnaround",
        "auto_generate": True,
        "depends_on": ["white_bg"],
        "prompt_hint": (
            "单张横排四格拼图（一次出图）：最左近景特写，后接正/侧/背；"
            "同一产品锁定材质比例与外观，禁止每格换款；干净背景，商业摄影…"
        ),
        "gen_mode": "i2i",
        "imageAspect": "2:1",
    },
]


def _manifest_from_state(state: dict) -> list[dict[str, Any]]:
    existing = [
        dict(it)
        for it in (state.get("split_manifest") or [])
        if isinstance(it, dict) and str(it.get("key") or "") in PHASE1_ASSET_KEYS
    ]
    by_key = {str(it["key"]): it for it in existing if it.get("key")}
    out: list[dict[str, Any]] = []
    for tmpl in PHASE1_MANIFEST_TEMPLATE:
        key = str(tmpl["key"])
        out.append({**tmpl, **by_key[key]} if key in by_key else dict(tmpl))
    return out


def _batch_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    batch: list[dict[str, Any]] = []
    for item in items:
        entry: dict[str, Any] = {
            "key": item["key"],
            "title": item["title"],
            "targetType": item["target_type"],
            "prompt": item.get("prompt_hint") or "",
        }
        if item.get("pipeline"):
            entry["pipeline"] = item["pipeline"]
        if item.get("imageAspect"):
            entry["imageAspect"] = item["imageAspect"]
        elif item["key"] == "product_turnaround":
            entry["imageAspect"] = "2:1"
        batch.append(entry)
    return batch


async def _apply_sidebar_to_seed(nest: Any, state: dict, seed_node_id: str) -> None:
    attachments = state.get("sidebar_attachments") or []
    if not attachments:
        return
    apply_fn = getattr(nest, "apply_sidebar_attachments", None)
    if apply_fn is None:
        return
    result = await apply_fn(
        node_ids=[seed_node_id],
        attachments=attachments,
        ref_order=state.get("sidebar_ref_order"),
        mode="localRefs",
    )


def _is_gen_success(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status") or "").lower()
    url = result.get("url")
    has_url = isinstance(url, str) and bool(url.strip())
    return status in ("completed", "success") or has_url


async def _run_key_generation(
    nest: Any, item: dict[str, Any], by_key: dict[str, dict[str, Any]]
) -> str | None:
    node_id = str(item.get("node_id") or "").strip()
    if not node_id:
        return f"节点 {item.get('key')} 缺少 node_id"
    attach_fn = getattr(nest, "attach_refs", None)
    if attach_fn is not None:
        ref_order = build_chain_ref_order(
            item=dict(item),
            by_key=by_key,
            plan_node_id=None,
        )
        if ref_order:
            await attach_fn(node_id, ref_order)
    run_fn = getattr(nest, "run_image_generation", None)
    if run_fn is None:
        return "无法触发出图"
    try:
        result = await run_fn(node_id)
    except Exception as exc:  # noqa: BLE001
        return str(exc)
    if not _is_gen_success(result):
        return str(result.get("status") or "error")
    return None


async def _wire_phase1_edges(nest: Any, by_key: dict[str, dict[str, Any]]) -> None:
    wb_id = str(by_key.get("white_bg", {}).get("node_id") or "").strip()
    ta_id = str(by_key.get("product_turnaround", {}).get("node_id") or "").strip()
    if wb_id and ta_id:
        connect_fn = getattr(nest, "connect_nodes", None)
        if connect_fn is not None:
            await connect_fn([{"source": wb_id, "target": ta_id}])
    ta_item = by_key.get("product_turnaround")
    attach_fn = getattr(nest, "attach_refs", None)
    if attach_fn is not None and ta_item and ta_item.get("node_id"):
        ref_order = build_chain_ref_order(
            item=dict(ta_item),
            by_key=by_key,
            plan_node_id=None,
        )
        if ref_order:
            await attach_fn(str(ta_item["node_id"]), ref_order)


async def ensure_phase1_seed_chain(
    nest: Any | None,
    state: dict,
    *,
    run_generation: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Ensure white_bg + product_turnaround nodes exist; optionally run seed chain gen."""
    manifest = _manifest_from_state(state)
    by_key = {str(it["key"]): it for it in manifest if it.get("key")}

    missing = [
        by_key[k]
        for k in PHASE1_ASSET_KEYS
        if not str(by_key.get(k, {}).get("node_id") or "").strip()
    ]

    if missing:
        if nest is None:
            return manifest, {
                "phase": "error",
                "messages": [AIMessage(content="无法创建 Phase 1 画布节点。")],
            }
        add_fn = getattr(nest, "add_nodes_batch", None)
        if add_fn is None:
            return manifest, {
                "phase": "error",
                "messages": [AIMessage(content="无法创建 Phase 1 画布节点。")],
            }
        try:
            batch = await add_fn(_batch_items(missing))
        except Exception as exc:  # noqa: BLE001
            return manifest, {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=f"创建 Phase 1 节点失败：{exc}")],
            }
        key_to_id = {
            str(n.get("key") or ""): str(n.get("nodeId") or "").strip()
            for n in (batch.get("nodes") or [])
            if isinstance(n, dict)
        }
        for item in missing:
            nid = key_to_id.get(str(item["key"]))
            if nid:
                by_key[str(item["key"])]["node_id"] = nid

        if any(
            not str(by_key.get(k, {}).get("node_id") or "").strip() for k in PHASE1_ASSET_KEYS
        ):
            return list(by_key.values()), {
                "phase": "error",
                "messages": [AIMessage(content="创建 Phase 1 节点失败：未返回 nodeId。")],
            }

        await _wire_phase1_edges(nest, by_key)

    seed_id = str(by_key.get("white_bg", {}).get("node_id") or "")
    if seed_id and nest is not None:
        await _apply_sidebar_to_seed(nest, state, seed_id)

    manifest = [by_key[k] for k in PHASE1_ASSET_KEYS if k in by_key]

    if run_generation and nest is not None:
        for key in PHASE1_ASSET_KEYS:
            item = by_key[key]
            err = await _run_key_generation(nest, item, by_key)
            if err:
                title = str(item.get("title") or key)
                return manifest, {
                    "phase": "error",
                    "last_error": err,
                    "messages": [AIMessage(content=f"Phase 1 出图失败（{title}）：{err}")],
                }

    return manifest, None
