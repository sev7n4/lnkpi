"""Tool tier registry — SSOT for explore vs graph-only tools (Hybrid A)."""

from __future__ import annotations

from enum import Enum


class ToolTier(str, Enum):
    READ = "read"
    WRITE_LIGHT = "write_light"
    LIFECYCLE = "lifecycle"
    GEN = "gen"
    DESTRUCTIVE = "destructive"
    GRAPH_BATCH = "graph_batch"
    EXPORT = "export"
    # ui_command: focus_node, undo — not in TOOL_TIERS; see design spec §1.3


# Explore sub-graph explicit allowlist (CS-4: no gen, no batch topology).
EXPLORE_TOOL_NAMES = frozenset({
    "get_canvas_summary",
    "get_node",
    "get_generation_status",
    "get_generation_diagnostic",
    "set_node_prompt",
    "set_node_content",
    "attach_refs",
    "upsert_prompt_node",
    "cancel_generation",
    "confirm_platform_fallback",
    "cancel_platform_fallback",
    "list_generation_tasks",
    "list_user_assets",
    "list_public_assets",
    "save_node_to_asset_library",
    "introduce_nodes_to_agent",
    "apply_asset_to_node",
    "apply_sidebar_attachments",
    "focus_node",
})

TOOL_TIERS: dict[str, ToolTier] = {
    "get_canvas_summary": ToolTier.READ,
    "get_node": ToolTier.READ,
    "get_generation_status": ToolTier.READ,
    "get_generation_diagnostic": ToolTier.READ,
    "set_node_prompt": ToolTier.WRITE_LIGHT,
    "set_node_content": ToolTier.WRITE_LIGHT,
    "attach_refs": ToolTier.WRITE_LIGHT,
    "upsert_prompt_node": ToolTier.WRITE_LIGHT,
    "apply_sidebar_attachments": ToolTier.WRITE_LIGHT,
    "cancel_generation": ToolTier.LIFECYCLE,
    "confirm_platform_fallback": ToolTier.LIFECYCLE,
    "cancel_platform_fallback": ToolTier.LIFECYCLE,
    "list_generation_tasks": ToolTier.READ,
    "list_user_assets": ToolTier.READ,
    "list_public_assets": ToolTier.READ,
    "save_node_to_asset_library": ToolTier.WRITE_LIGHT,
    "apply_asset_to_node": ToolTier.WRITE_LIGHT,
    "introduce_nodes_to_agent": ToolTier.WRITE_LIGHT,
    "get_canvas_layout": ToolTier.READ,
    "duplicate_node": ToolTier.WRITE_LIGHT,
    "upload_media_to_canvas": ToolTier.WRITE_LIGHT,
    "export_media_package": ToolTier.EXPORT,
    "optimize_prompt": ToolTier.READ,
    "group_nodes": ToolTier.GRAPH_BATCH,
    "ungroup_node": ToolTier.GRAPH_BATCH,
    "arrange_nodes_grid": ToolTier.GRAPH_BATCH,
    "run_icon_refine": ToolTier.GEN,
    "get_image_edit_capabilities": ToolTier.READ,
    "add_nodes_batch": ToolTier.GRAPH_BATCH,
    "connect_nodes": ToolTier.GRAPH_BATCH,
    "update_nodes_batch": ToolTier.GRAPH_BATCH,
    "run_image_generation": ToolTier.GEN,
    "run_video_generation": ToolTier.GEN,
    "run_text_generation": ToolTier.GEN,
    "run_prompt_generation": ToolTier.GEN,
    "run_audio_generation": ToolTier.GEN,
    "start_image_generation": ToolTier.GEN,
    "wait_image_generation": ToolTier.GEN,
    "remove_nodes": ToolTier.DESTRUCTIVE,
    "remove_edges": ToolTier.DESTRUCTIVE,
}

GRAPH_ONLY_TOOL_NAMES = frozenset(TOOL_TIERS.keys()) - EXPLORE_TOOL_NAMES


def is_explore_tool(name: str) -> bool:
    return name in EXPLORE_TOOL_NAMES
