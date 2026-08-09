"""28-tool explore contract cases — shared by CI contract tests and prod demo."""

from __future__ import annotations

from dataclasses import dataclass

from app.graph.explore_dispatch import ExploreIntent

SUMMARY = {
    "nodes": [
        {"id": "image-1786157513657-20", "title": "换logo李宁"},
        {"id": "image-1786156321418-15", "title": "颜色变体1"},
        {"id": "image-1786156321418-16", "title": "颜色变体2"},
        {"id": "image-16", "title": "demo"},
        {"id": "prompt-1", "title": "prompt-1"},
        {"id": "text-40", "title": "text-40"},
        {"id": "image-shoes-demo", "title": "让模特穿上这双鞋子"},
    ]
}


@dataclass(frozen=True)
class ExploreContractCase:
    tool: str
    message: str
    expected_intent: ExploreIntent
    mandatory_tool: str | None = None
    expect_canvas_cmd: str | None = None


EXPLORE_CONTRACT_CASES: tuple[ExploreContractCase, ...] = (
    ExploreContractCase(
        "get_canvas_summary",
        "查询画布上有哪些节点？列出每个节点的类型和状态",
        "open_query",
    ),
    ExploreContractCase(
        "get_node",
        "查询节点 image-16 的详细信息，包括 url 和 status",
        "node_read",
    ),
    ExploreContractCase(
        "get_canvas_layout",
        "查询画布各节点的坐标位置和分组 layout 信息",
        "open_query",
    ),
    ExploreContractCase(
        "get_generation_status",
        "查询 image-16 这个节点当前的生成状态",
        "node_read",
    ),
    ExploreContractCase(
        "get_generation_diagnostic",
        "image-16 生成失败了，查询诊断信息和失败原因",
        "node_read",
    ),
    ExploreContractCase(
        "list_generation_tasks",
        "列出本会话所有生成任务，哪些在排队哪些已完成",
        "open_query",
    ),
    ExploreContractCase(
        "list_user_assets",
        "查询我的资产库有哪些素材，列出名称和类型",
        "asset_read",
        mandatory_tool="list_user_assets",
    ),
    ExploreContractCase(
        "list_public_assets",
        "查询平台公共素材库有哪些内容",
        "asset_read",
        mandatory_tool="list_public_assets",
    ),
    ExploreContractCase(
        "get_image_edit_capabilities",
        "查询「换logo李宁」这个图片节点支持哪些精修编辑模式？",
        "node_read",
    ),
    ExploreContractCase(
        "upsert_prompt_node",
        "查询画布空白区域，用工具添加一个 prompt 节点，标题 explore-upsert-demo，"
        "prompt 字段写 explore-upsert-test（不要触发出图）",
        "node_write",
    ),
    ExploreContractCase(
        "set_node_prompt",
        "查询 prompt-1 节点，把它的 prompt 字段更新为 explore-set-prompt-测试文案",
        "node_write",
    ),
    ExploreContractCase(
        "set_node_content",
        "查询 text-40 文案节点，把内容更新为 explore-set-content-测试",
        "node_write",
    ),
    ExploreContractCase(
        "attach_refs",
        "查询 prompt-1 节点，把 image-16 作为参考图 attach 挂上去",
        "node_write",
    ),
    ExploreContractCase(
        "apply_sidebar_attachments",
        "查询 prompt-1 节点，把侧栏 @I1 引用写到 localRefs（apply sidebar attachments）",
        "ui_command",
    ),
    ExploreContractCase(
        "duplicate_node",
        "查询「换logo李宁」节点并复制一份，偏移一点位置",
        "node_write",
    ),
    ExploreContractCase(
        "upload_media_to_canvas",
        "查询画布，把图片 URL https://picsum.photos/seed/explore28demo/512/512 "
        "上传到画布加一个 image 节点（仅上传，不要出图）",
        "node_write",
    ),
    ExploreContractCase(
        "introduce_nodes_to_agent",
        "查询「换logo李宁」节点并引入到 Agent 侧栏对话上下文",
        "ui_command",
        mandatory_tool="introduce_nodes_to_agent",
        expect_canvas_cmd="introduce_nodes",
    ),
    ExploreContractCase(
        "save_node_to_asset_library",
        "查询「换logo李宁」节点并保存到我的资产库",
        "node_write",
    ),
    ExploreContractCase(
        "apply_asset_to_node",
        "查询 prompt-1 节点，从我资产库选一张图应用到它上面",
        "node_write",
    ),
    ExploreContractCase(
        "cancel_generation",
        "查询并取消 image-16 节点上正在进行的生成任务",
        "lifecycle",
        mandatory_tool="cancel_generation",
    ),
    ExploreContractCase(
        "cancel_platform_fallback",
        "查询「让模特穿上这双鞋子」节点，取消这次平台回退 fallback",
        "lifecycle",
        mandatory_tool="cancel_platform_fallback",
    ),
    ExploreContractCase(
        "confirm_platform_fallback",
        "查询「让模特穿上这双鞋子」节点，确认使用平台通道继续 fallback",
        "lifecycle",
        mandatory_tool="confirm_platform_fallback",
    ),
    ExploreContractCase(
        "export_media_package",
        "查询并导出「换logo李宁」节点的图片下载链接",
        "node_read",
    ),
    ExploreContractCase(
        "focus_node",
        "查询「换logo李宁」节点，把视口定位到它",
        "ui_command",
        mandatory_tool="focus_node",
        expect_canvas_cmd="focus_node",
    ),
    ExploreContractCase(
        "focus_nodes",
        "查询颜色变体1到4节点，把视口定位到它们",
        "ui_command",
        mandatory_tool="focus_nodes",
        expect_canvas_cmd="focus_nodes",
    ),
    ExploreContractCase(
        "undo",
        "查询画布，撤销上一步画布编辑操作",
        "ui_command",
        mandatory_tool="undo",
        expect_canvas_cmd="undo",
    ),
    ExploreContractCase(
        "redo",
        "查询画布，重做刚才撤销的画布操作",
        "ui_command",
        mandatory_tool="redo",
        expect_canvas_cmd="redo",
    ),
    ExploreContractCase(
        "open_image_editor",
        "查询「换logo李宁」图片节点并打开精修编辑器",
        "ui_command",
        mandatory_tool="open_image_editor",
        expect_canvas_cmd="open_image_editor",
    ),
)
