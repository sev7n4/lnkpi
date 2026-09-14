"""Tool tier + placement registry — SSOT for explore vs graph-only tools (Hybrid A)."""

from __future__ import annotations

from enum import Enum


class ToolPlacement(str, Enum):
    EXPLORE = "explore"
    GRAPH_NODE = "graph_node"
    UI_COMMAND = "ui_command"


class ToolExposure(str, Enum):
    CORE = "core"
    DEFERRED = "deferred"
    GRAPH_ONLY = "graph_only"
    META = "meta"


class ToolTier(str, Enum):
    READ = "read"
    WRITE_LIGHT = "write_light"
    LIFECYCLE = "lifecycle"
    GEN = "gen"
    DESTRUCTIVE = "destructive"
    GRAPH_BATCH = "graph_batch"
    EXPORT = "export"
    WORKFLOW_IO = "workflow_io"  # export/import style canvas IO
    # ui_command: focus_node, undo — not in TOOL_TIERS; see design spec §1.3


# Placement SSOT: every build_canvas_tools name + explore-bound UI commands.
TOOL_PLACEMENTS: dict[str, ToolPlacement] = {
    "get_canvas_summary": ToolPlacement.EXPLORE,
    "get_node": ToolPlacement.EXPLORE,
    "get_generation_status": ToolPlacement.EXPLORE,
    "get_generation_diagnostic": ToolPlacement.EXPLORE,
    "set_node_prompt": ToolPlacement.EXPLORE,
    "set_node_content": ToolPlacement.EXPLORE,
    "attach_refs": ToolPlacement.EXPLORE,
    "upsert_prompt_node": ToolPlacement.EXPLORE,
    "cancel_generation": ToolPlacement.EXPLORE,
    "confirm_platform_fallback": ToolPlacement.EXPLORE,
    "cancel_platform_fallback": ToolPlacement.EXPLORE,
    "list_generation_tasks": ToolPlacement.EXPLORE,
    "list_user_assets": ToolPlacement.EXPLORE,
    "list_public_assets": ToolPlacement.EXPLORE,
    "save_node_to_asset_library": ToolPlacement.EXPLORE,
    "introduce_nodes_to_agent": ToolPlacement.EXPLORE,
    "apply_asset_to_node": ToolPlacement.EXPLORE,
    "apply_sidebar_attachments": ToolPlacement.EXPLORE,
    "get_canvas_layout": ToolPlacement.EXPLORE,
    "duplicate_node": ToolPlacement.EXPLORE,
    "upload_media_to_canvas": ToolPlacement.EXPLORE,
    "export_media_package": ToolPlacement.EXPLORE,
    "get_image_edit_capabilities": ToolPlacement.EXPLORE,
    "import_workflow": ToolPlacement.EXPLORE,
    "upsert_media_node": ToolPlacement.EXPLORE,
    "propose_generation": ToolPlacement.EXPLORE,
    "connect_nodes": ToolPlacement.EXPLORE,
    "tool_search": ToolPlacement.EXPLORE,
    "focus_node": ToolPlacement.UI_COMMAND,
    "focus_nodes": ToolPlacement.UI_COMMAND,
    "undo": ToolPlacement.UI_COMMAND,
    "redo": ToolPlacement.UI_COMMAND,
    "open_image_editor": ToolPlacement.UI_COMMAND,
    "add_nodes_batch": ToolPlacement.GRAPH_NODE,
    "run_image_generation": ToolPlacement.GRAPH_NODE,
    "group_nodes": ToolPlacement.GRAPH_NODE,
    "ungroup_node": ToolPlacement.GRAPH_NODE,
    "arrange_nodes_grid": ToolPlacement.GRAPH_NODE,
    "move_nodes": ToolPlacement.GRAPH_NODE,
    "apply_layout_ops": ToolPlacement.GRAPH_NODE,
}

DEFERRED_TOOL_NAMES = frozenset({
    "get_image_edit_capabilities",
    "list_public_assets",
    "introduce_nodes_to_agent",
})

TOOL_EXPOSURES: dict[str, ToolExposure] = {
    name: (
        ToolExposure.META
        if name == "tool_search"
        else ToolExposure.GRAPH_ONLY
        if placement == ToolPlacement.GRAPH_NODE
        else ToolExposure.DEFERRED
        if name in DEFERRED_TOOL_NAMES
        else ToolExposure.CORE
    )
    for name, placement in TOOL_PLACEMENTS.items()
}

# Explore whitelist: EXPLORE + UI_COMMAND (ui cmds are explore-bound today).
EXPLORE_TOOL_NAMES = frozenset(
    n for n, p in TOOL_PLACEMENTS.items()
    if p in (ToolPlacement.EXPLORE, ToolPlacement.UI_COMMAND)
)

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
    "import_workflow": ToolTier.WORKFLOW_IO,
    "upsert_media_node": ToolTier.WRITE_LIGHT,
    "propose_generation": ToolTier.WRITE_LIGHT,
    "optimize_prompt": ToolTier.READ,
    "group_nodes": ToolTier.GRAPH_BATCH,
    "ungroup_node": ToolTier.GRAPH_BATCH,
    "arrange_nodes_grid": ToolTier.GRAPH_BATCH,
    "move_nodes": ToolTier.GRAPH_BATCH,
    "apply_layout_ops": ToolTier.GRAPH_BATCH,
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

GRAPH_ONLY_TOOL_NAMES = frozenset(
    n for n, p in TOOL_PLACEMENTS.items() if p == ToolPlacement.GRAPH_NODE
)

# Seeds for I3 — names expected to appear under app/graph (rg nest./getattr(nest)).
GRAPH_NODE_CALL_SITES = frozenset({
    "add_nodes_batch",
    "connect_nodes",
    "run_image_generation",
    "run_video_generation",
    "run_text_generation",
    "run_prompt_generation",
    "run_audio_generation",
    "start_image_generation",
    "wait_image_generation",
    "remove_nodes",
})

# graph_node specs not yet invoked from nodes (pre-existing debt).
# Do NOT put import_workflow here.
DEFERRED_GRAPH_NODE_TOOLS = frozenset({
    "group_nodes",  # layout batch spec; no graph node invokes it yet
    "ungroup_node",  # layout batch spec; no graph node invokes it yet
    "arrange_nodes_grid",  # layout batch spec; no graph node invokes it yet
    "move_nodes",  # layout batch spec; no graph node invokes it yet
    "apply_layout_ops",  # layout batch spec; no graph node invokes it yet
})


def is_explore_tool(name: str) -> bool:
    return name in EXPLORE_TOOL_NAMES
