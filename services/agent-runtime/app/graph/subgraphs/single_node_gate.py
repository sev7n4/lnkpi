"""W29: single_node_gate — focus canvas node → gen fan-out → done (no plan/split)."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from app.graph.state import SplitManifestItem

_GEN_TYPES = frozenset({"image", "video"})


def manifest_item_from_canvas_node(node: dict[str, Any]) -> SplitManifestItem | None:
    """Build one manifest row from a canvas node snapshot."""
    node_id = str(node.get("id") or "").strip()
    if not node_id:
        return None
    node_type = str(node.get("type") or "image")
    target = node_type if node_type in _GEN_TYPES else "image"
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    hint = str(data.get("prompt") or data.get("content") or "").strip()
    suffix = node_id.replace("-", "_")[-12:]
    key = f"single_{suffix}" if suffix else "single_node"
    return SplitManifestItem(
        key=key,
        title=str(node.get("title") or key),
        target_type=target,  # type: ignore[arg-type]
        node_id=node_id,
        depends_on=[],
        auto_generate=True,
        prompt_hint=hint,
    )


def make_prepare_single_gen_node(*, nest: Any) -> Any:
    """Resolve focus_node_id → single-item manifest, then hand off to start_gen."""

    async def prepare_single_gen(state: dict) -> dict:
        node_id = str(state.get("focus_node_id") or "").strip()
        if not node_id:
            return {
                "phase": "error",
                "last_error": "missing focus_node_id",
                "messages": [AIMessage(content="未指定要生成的画布节点，请先选中节点后重试。")],
            }
        get_node = getattr(nest, "get_node", None)
        if get_node is None:
            return {
                "phase": "error",
                "messages": [AIMessage(content="无法读取画布节点。")],
            }
        try:
            node = await get_node(node_id)
        except Exception as exc:  # noqa: BLE001
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=f"读取节点失败：{exc}")],
            }
        item = manifest_item_from_canvas_node(node if isinstance(node, dict) else {})
        if item is None:
            return {
                "phase": "error",
                "messages": [AIMessage(content="节点无效，无法快速生成。")],
            }
        key = str(item["key"])
        title = str(item.get("title") or key)
        return {
            "phase": "orchestrate_gen",
            "flow_mode": "single_node",
            "split_manifest": [item],
            "gen_ordered_keys": [key],
            "user_decision": "confirm_gen",
            "messages": [
                AIMessage(content=f"单节点快速生成：{title}（跳过方案/拓扑全链路）。")
            ],
        }

    return prepare_single_gen


def register_single_node_gate(graph: Any, *, nest: Any) -> None:
    """Register prepare_single_gen; reuses topo_gate start_gen → collect_gen → done."""
    graph.add_node("prepare_single_gen", make_prepare_single_gen_node(nest=nest))
    graph.add_edge("prepare_single_gen", "start_gen")
