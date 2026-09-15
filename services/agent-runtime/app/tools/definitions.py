from __future__ import annotations

import json
from typing import Any, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, model_validator

from app.tools.nest_client import NestCanvasClient
from app.tools.prompt_templates import (
    UPSERT_PROMPT_NODE_CONTENT_FIELD,
    UPSERT_PROMPT_NODE_PROMPT_FIELD,
    upsert_prompt_node_tool_description,
)
from app.tools.tool_registry import EXPLORE_TOOL_NAMES, is_explore_tool
from app.tools.tool_search import make_tool_search_tool

EXPLORE_READ_TOOLS = frozenset({
    "get_canvas_summary",
    "get_node",
    "get_canvas_layout",
    "get_generation_status",
    "get_generation_diagnostic",
    "list_generation_tasks",
    "get_image_edit_capabilities",
    "export_media_package",
})

EXPLORE_WRITE_TOOLS = frozenset({
    "set_node_prompt",
    "set_node_content",
    "attach_refs",
    "upsert_prompt_node",
    "upsert_media_node",
    "propose_generation",
    "connect_nodes",
    "duplicate_node",
    "upload_media_to_canvas",
    "apply_sidebar_attachments",
    "save_node_to_asset_library",
    "apply_asset_to_node",
    "import_workflow",
    "match_workflow_templates",
    "preview_workflow_template",
    "instantiate_workflow_template",
    "promote_workflow_template",
})

CONNECT_NODES_MAX_EDGES = 20

DEFAULT_WRITE_BIND = frozenset({
    "set_node_prompt",
    "set_node_content",
    "attach_refs",
    "duplicate_node",
    "upsert_prompt_node",
})


class UpsertPromptNodeInput(BaseModel):
    prompt: str = Field(description=UPSERT_PROMPT_NODE_PROMPT_FIELD)
    content: str = Field(description=UPSERT_PROMPT_NODE_CONTENT_FIELD)
    node_id: str | None = Field(default=None, description="Existing node id to update")


class UpsertMediaNodeInput(BaseModel):
    target_type: str = Field(description="Media node type: image, video, text, or audio")
    prompt: str = Field(description="Generation prompt to store on the media node")
    title: str | None = Field(default=None, description="Optional node title")
    node_id: str | None = Field(default=None, description="Existing media node id to update")


class NodeIdInput(BaseModel):
    node_id: str = Field(description="Canvas node id")


class GenerationRecordInput(BaseModel):
    generation_record_id: str | None = Field(
        default=None, description="Studio generation record id (optional if node_id provided)"
    )
    node_id: str | None = Field(
        default=None,
        description=(
            "Canvas node id such as image-16 — required for lifecycle tools when "
            "generation_record_id is unknown; resolve from canvas summary, not title text"
        ),
    )


class AddNodesBatchInput(BaseModel):
    items: list[dict[str, Any]] = Field(
        description="Batch node specs with key, title, targetType, optional prompt/position"
    )


class ImportWorkflowInput(BaseModel):
    workflow: dict[str, Any] | None = Field(
        default=None,
        description="lnkpi.workflow JSON object to merge into the current canvas",
    )
    workflow_url: str | None = Field(
        default=None,
        description="HTTPS URL that returns lnkpi.workflow JSON (used when workflow is omitted)",
    )

    @model_validator(mode="after")
    def require_workflow_or_url(self) -> ImportWorkflowInput:
        if self.workflow is None and not (self.workflow_url or "").strip():
            raise ValueError("workflow or workflow_url is required")
        return self


class MatchWorkflowTemplatesInput(BaseModel):
    utterance: str = Field(description="用户原话，用来认亲最接近的工作流模板")


class PreviewWorkflowTemplateInput(BaseModel):
    parent_id: str = Field(description="主模板 id")
    parent_version: str = Field(description="主模板版本")
    delta: dict[str, Any] = Field(
        description="相对主模板的结构改动：增删节点、改连线，可选接到另一套模板",
    )


class InstantiateWorkflowTemplateInput(BaseModel):
    parent_id: str = Field(description="主模板 id")
    parent_version: str = Field(description="主模板版本")
    delta: dict[str, Any] | None = Field(
        default=None,
        description="相对主模板的结构改动；确认原模板则传空对象",
    )
    slots: dict[str, str] | None = Field(default=None, description="可选槽位填入，如节点提示词")
    utterance: str | None = Field(default=None, description="用户原话，用于填槽")


class PromoteWorkflowTemplateInput(BaseModel):
    mode: Literal["variant", "new_template"] = Field(
        description=(
            "variant=保存为当前模板的改版；new_template=存成一套新模板。"
            "必须先在对话里让用户选择；认不到父模板时只能 new_template。"
        ),
    )
    workflow: dict[str, Any] | None = Field(
        default=None,
        description="lnkpi.workflow JSON；省略则由服务端从当前画布导出",
    )
    confirmed_seed_keys: list[str] | None = Field(
        default=None,
        description="新模板二次确认后带上用户确认的核心步骤 key；第一步预览不要带",
    )
    title: str | None = Field(default=None, description="可选模板标题")
    parent_id: str | None = Field(default=None, description="改版时的父模板 id")
    parent_version: str | None = Field(default=None, description="改版时的父模板版本")
    confirmed: bool | None = Field(
        default=None,
        description="改版二次确认后为 true；第一步预览不要带",
    )


class ConnectNodesInput(BaseModel):
    edges: list[dict[str, str]] = Field(description="Directed edges as source/target node ids")


class SetNodePromptInput(BaseModel):
    node_id: str = Field(description="Canvas node id")
    prompt: str = Field(description="Updated prompt text")


class SetNodeContentInput(BaseModel):
    node_id: str = Field(description="Canvas node id")
    content: str = Field(description="Updated node content text")


class AttachRefsInput(BaseModel):
    node_id: str = Field(description="Target node id")
    ref_order: list[str] = Field(description="Ordered reference node ids")


class IntroduceNodesInput(BaseModel):
    node_ids: list[str] = Field(description="Canvas node ids to add as agent sidebar refs")


class ListPublicAssetsInput(BaseModel):
    kind: str | None = Field(default=None, description="Filter: image, video, or audio")
    search: str | None = Field(default=None, description="Label search substring")


class ApplyAssetInput(BaseModel):
    node_id: str = Field(description="Target canvas node id")
    asset_id: str = Field(description="User or public asset id")
    source: str = Field(description="user or public")


class SaveNodeAssetInput(BaseModel):
    node_id: str = Field(description="Canvas node with media to save")
    label: str | None = Field(default=None, description="Optional asset label override")


class ApplySidebarAttachmentsInput(BaseModel):
    node_ids: list[str] = Field(description="Target canvas node ids")
    attachments: list[dict[str, Any]] = Field(description="Sidebar attachment payloads")
    ref_order: list[str] | None = Field(default=None, description="Attachment id order")
    mode: str = Field(description="localRefs or attach_edges")
    mentioned_keys: list[str] | None = Field(
        default=None, description="Explicit @I1-style mention keys"
    )


class FocusNodesInput(BaseModel):
    node_ids: list[str] = Field(description="Canvas node ids to focus in viewport")


class DuplicateNodeInput(BaseModel):
    node_id: str | None = Field(default=None, description="Single seed node id")
    node_ids: list[str] | None = Field(default=None, description="Multi-select subgraph ids")
    include_upstream: bool = Field(
        default=False,
        description="When duplicating a single node, also copy direct upstream nodes and edges (one hop only)",
    )


class UploadMediaInput(BaseModel):
    url: str = Field(description="Public media URL to attach")
    media_type: str = Field(description="image, video, or audio")
    title: str | None = Field(default=None, description="Optional node title")


class ExportMediaInput(BaseModel):
    node_ids: list[str] = Field(description="Node ids whose media URLs to export")


class GroupNodesInput(BaseModel):
    node_ids: list[str] = Field(description="At least two node ids to group")
    title: str | None = Field(default=None, description="Optional group title")


class UngroupNodeInput(BaseModel):
    group_id: str = Field(description="Group node id to dissolve")


class ArrangeNodesGridInput(BaseModel):
    node_ids: list[str] = Field(description="Node ids to arrange in a grid")
    gap: int | None = Field(default=None, description="Grid gap in pixels")


class ListGenerationTasksInput(BaseModel):
    type: str | None = Field(default=None, description="Optional filter: image, video, etc.")


class OpenImageEditorInput(BaseModel):
    node_id: str = Field(description="Image node id to open in the refine editor")


class MoveNodeItemInput(BaseModel):
    node_id: str = Field(description="Canvas node id")
    x: float = Field(description="Absolute canvas X coordinate")
    y: float = Field(description="Absolute canvas Y coordinate")


class MoveNodesInput(BaseModel):
    items: list[MoveNodeItemInput] = Field(description="Nodes to move by absolute coordinates")


class ApplyLayoutOpsInput(BaseModel):
    ops: list[dict[str, Any]] = Field(
        description=(
            "Ordered layout ops: group, ungroup, arrange_grid, move "
            "(see canvas layout workflow harness)"
        )
    )


def _all_tool_specs(client: NestCanvasClient) -> list[tuple[str, StructuredTool]]:
    """Return (name, tool) pairs for registry filtering."""

    async def upsert_prompt_node(prompt: str, content: str, node_id: str | None = None) -> dict:
        return await client.upsert_prompt_node(prompt=prompt, content=content, node_id=node_id)

    async def get_canvas_summary() -> dict:
        return await client.get_canvas_summary()

    async def get_node(node_id: str) -> dict:
        return await client.get_node(node_id)

    async def add_nodes_batch(items: list[dict[str, Any]]) -> dict:
        return await client.add_nodes_batch(items)

    async def import_workflow(
        workflow: dict[str, Any] | None = None,
        workflow_url: str | None = None,
    ) -> dict:
        if workflow is None and not (workflow_url or "").strip():
            raise ValueError("workflow or workflow_url is required")
        return await client.import_workflow(workflow=workflow, workflow_url=workflow_url)

    async def match_workflow_templates(utterance: str) -> dict:
        return await client.match_recipes(utterance=utterance)

    async def preview_workflow_template(
        parent_id: str,
        parent_version: str,
        delta: dict[str, Any],
    ) -> dict:
        return await client.preview_recipe_delta(
            parent_id=parent_id,
            parent_version=parent_version,
            delta=delta,
        )

    async def instantiate_workflow_template(
        parent_id: str,
        parent_version: str,
        delta: dict[str, Any] | None = None,
        slots: dict[str, str] | None = None,
        utterance: str | None = None,
    ) -> dict:
        return await client.instantiate_recipe(
            parent_id=parent_id,
            parent_version=parent_version,
            delta=delta,
            slots=slots,
            utterance=utterance,
        )

    async def promote_workflow_template(
        mode: Literal["variant", "new_template"],
        workflow: dict[str, Any] | None = None,
        confirmed_seed_keys: list[str] | None = None,
        title: str | None = None,
        parent_id: str | None = None,
        parent_version: str | None = None,
        confirmed: bool | None = None,
    ) -> dict:
        return await client.promote_recipe(
            mode=mode,
            workflow=workflow,
            confirmed_seed_keys=confirmed_seed_keys,
            title=title,
            parent_id=parent_id,
            parent_version=parent_version,
            confirmed=confirmed,
        )

    async def upsert_media_node(
        target_type: str,
        prompt: str,
        title: str | None = None,
        node_id: str | None = None,
    ) -> dict:
        return await client.upsert_media_node(
            target_type=target_type,
            prompt=prompt,
            title=title,
            node_id=node_id,
        )

    async def propose_generation(node_id: str) -> dict:
        return await client.propose_generation(node_id)

    async def connect_nodes(edges: list[dict[str, str]]) -> dict:
        if len(edges) > CONNECT_NODES_MAX_EDGES:
            raise ValueError(
                f"connect_nodes accepts at most {CONNECT_NODES_MAX_EDGES} edges per call "
                f"(got {len(edges)})"
            )
        return await client.connect_nodes(edges)

    async def set_node_prompt(node_id: str, prompt: str) -> dict:
        return await client.set_node_prompt(node_id, prompt)

    async def set_node_content(node_id: str, content: str) -> dict:
        return await client.set_node_content(node_id, content)

    async def attach_refs(node_id: str, ref_order: list[str]) -> dict:
        return await client.attach_refs(node_id, ref_order)

    async def run_image_generation(node_id: str) -> dict:
        return await client.run_image_generation(node_id)

    async def get_generation_status(node_id: str) -> dict:
        return await client.get_generation_status(node_id)

    async def get_generation_diagnostic(
        generation_record_id: str | None = None, node_id: str | None = None
    ) -> dict:
        return await client.get_generation_diagnostic(
            generation_record_id=generation_record_id, node_id=node_id
        )

    async def cancel_generation(
        generation_record_id: str | None = None, node_id: str | None = None
    ) -> dict:
        return await client.cancel_generation(
            generation_record_id=generation_record_id, node_id=node_id
        )

    async def confirm_platform_fallback(
        generation_record_id: str | None = None, node_id: str | None = None
    ) -> dict:
        return await client.confirm_platform_fallback(
            generation_record_id=generation_record_id, node_id=node_id
        )

    async def cancel_platform_fallback(
        generation_record_id: str | None = None, node_id: str | None = None
    ) -> dict:
        return await client.cancel_platform_fallback(
            generation_record_id=generation_record_id, node_id=node_id
        )

    async def list_generation_tasks(type: str | None = None) -> dict:
        return await client.list_generation_tasks(type=type)

    async def list_user_assets() -> dict:
        return await client.list_user_assets()

    async def list_public_assets(kind: str | None = None, search: str | None = None) -> dict:
        return await client.list_public_assets(kind=kind, search=search)

    async def save_node_to_asset_library(
        node_id: str, label: str | None = None
    ) -> dict:
        return await client.save_node_to_asset_library(node_id=node_id, label=label)

    async def introduce_nodes_to_agent(node_ids: list[str]) -> dict:
        return await client.introduce_nodes_to_agent(node_ids=node_ids)

    async def apply_asset_to_node(node_id: str, asset_id: str, source: str) -> dict:
        return await client.apply_asset_to_node(
            node_id=node_id, asset_id=asset_id, source=source
        )

    async def focus_node(node_id: str) -> dict:
        return {"ok": True, "canvasCommands": [{"type": "focus_node", "nodeId": node_id}]}

    async def focus_nodes(node_ids: list[str]) -> dict:
        return {"ok": True, "canvasCommands": [{"type": "focus_nodes", "nodeIds": node_ids}]}

    async def undo() -> dict:
        return {"ok": True, "canvasCommands": [{"type": "undo"}]}

    async def redo() -> dict:
        return {"ok": True, "canvasCommands": [{"type": "redo"}]}

    async def open_image_editor(node_id: str) -> dict:
        return {
            "ok": True,
            "canvasCommands": [{"type": "open_image_editor", "nodeId": node_id}],
        }

    async def get_canvas_layout() -> dict:
        return await client.get_canvas_layout()

    async def duplicate_node(
        node_id: str | None = None,
        node_ids: list[str] | None = None,
        include_upstream: bool = False,
    ) -> dict:
        return await client.duplicate_node(
            node_id=node_id,
            node_ids=node_ids,
            include_upstream=include_upstream,
        )

    async def upload_media_to_canvas(
        url: str, media_type: str, title: str | None = None
    ) -> dict:
        return await client.upload_media_to_canvas(
            url=url, media_type=media_type, title=title
        )

    async def export_media_package(node_ids: list[str]) -> dict:
        return await client.export_media_package(node_ids=node_ids)

    async def group_nodes(node_ids: list[str], title: str | None = None) -> dict:
        return await client.group_nodes(node_ids=node_ids, title=title)

    async def ungroup_node(group_id: str) -> dict:
        return await client.ungroup_node(group_id=group_id)

    async def arrange_nodes_grid(node_ids: list[str], gap: int | None = None) -> dict:
        return await client.arrange_nodes_grid(node_ids=node_ids, gap=gap)

    async def move_nodes(items: list[dict[str, Any]]) -> dict:
        normalized = [
            {
                "nodeId": str(item.get("node_id") or item.get("nodeId") or ""),
                "x": float(item["x"]),
                "y": float(item["y"]),
            }
            for item in items
        ]
        return await client.move_nodes(items=normalized)

    async def apply_layout_ops(ops: list[dict[str, Any]]) -> dict:
        return await client.apply_layout_ops(ops=ops)

    async def get_image_edit_capabilities(node_id: str) -> dict:
        return await client.get_image_edit_capabilities(node_id=node_id)

    async def apply_sidebar_attachments(
        node_ids: list[str],
        attachments: list[dict[str, Any]],
        mode: str,
        ref_order: list[str] | None = None,
        mentioned_keys: list[str] | None = None,
    ) -> dict:
        if isinstance(ref_order, str):
            try:
                parsed = json.loads(ref_order)
                ref_order = parsed if isinstance(parsed, list) else None
            except json.JSONDecodeError:
                ref_order = None
        if isinstance(mentioned_keys, str):
            try:
                parsed = json.loads(mentioned_keys)
                mentioned_keys = parsed if isinstance(parsed, list) else None
            except json.JSONDecodeError:
                mentioned_keys = None
        return await client.apply_sidebar_attachments(
            node_ids=node_ids,
            attachments=attachments,
            ref_order=ref_order,
            mode=mode,
            mentioned_keys=mentioned_keys,
        )

    specs: list[tuple[str, StructuredTool]] = [
        (
            "upsert_prompt_node",
            StructuredTool.from_function(
                coroutine=upsert_prompt_node,
                name="upsert_prompt_node",
                description=upsert_prompt_node_tool_description(),
                args_schema=UpsertPromptNodeInput,
            ),
        ),
        (
            "get_canvas_summary",
            StructuredTool.from_function(
                coroutine=get_canvas_summary,
                name="get_canvas_summary",
                description="List canvas nodes with id, type, title, status for exploration",
            ),
        ),
        (
            "get_node",
            StructuredTool.from_function(
                coroutine=get_node,
                name="get_node",
                description="Fetch a canvas node snapshot by id",
                args_schema=NodeIdInput,
            ),
        ),
        (
            "add_nodes_batch",
            StructuredTool.from_function(
                coroutine=add_nodes_batch,
                name="add_nodes_batch",
                description="Add multiple canvas nodes in one batch",
                args_schema=AddNodesBatchInput,
            ),
        ),
        (
            "import_workflow",
            StructuredTool.from_function(
                coroutine=import_workflow,
                name="import_workflow",
                description=(
                    "Merge an lnkpi.workflow JSON document into the current canvas "
                    "(validate, remap ids, place nodes). Not a zip import — pass a "
                    "workflow object or workflow_url."
                ),
                args_schema=ImportWorkflowInput,
            ),
        ),
        (
            "match_workflow_templates",
            StructuredTool.from_function(
                coroutine=match_workflow_templates,
                name="match_workflow_templates",
                description=(
                    "根据用户原话认亲最接近的工作流模板（最多 3 条摘要）。"
                    "只读目录，不改画布。跨套模板时可提示接到另一套。"
                ),
                args_schema=MatchWorkflowTemplatesInput,
            ),
        ),
        (
            "preview_workflow_template",
            StructuredTool.from_function(
                coroutine=preview_workflow_template,
                name="preview_workflow_template",
                description=(
                    "预览相对主模板的改版：增删节点、改连线，或接到另一套模板的核心步骤。"
                    "返回用户可读变化列表；非法改动会被剥掉并说明。"
                    "不写画布。确认结构后再调用 instantiate_workflow_template。"
                ),
                args_schema=PreviewWorkflowTemplateInput,
            ),
        ),
        (
            "instantiate_workflow_template",
            StructuredTool.from_function(
                coroutine=instantiate_workflow_template,
                name="instantiate_workflow_template",
                description=(
                    "把确认后的工作流模板实例化到当前画布（编译为 lnkpi.workflow 再导入）。"
                    "仅在用户确认结构之后调用；只传 parent_id、parent_version、delta，不要传完整模板。"
                    "本步不出图。"
                ),
                args_schema=InstantiateWorkflowTemplateInput,
            ),
        ),
        (
            "promote_workflow_template",
            StructuredTool.from_function(
                coroutine=promote_workflow_template,
                name="promote_workflow_template",
                description=(
                    "两步确认后再入库。第一步：用户选出改版或新模板后立刻调用，"
                    "改版不要带 confirmed，新模板不要带 confirmed_seed_keys；"
                    "会返回 needs_variant_confirm 或 needs_seed_confirm 与用户文案。"
                    "第二步：用户点头后再调用，改版带 confirmed=true，"
                    "新模板带 confirmed_seed_keys。禁止一条 tool 静默入库。"
                    "把导出的工作流晋升到当前用户的模板目录。"
                ),
                args_schema=PromoteWorkflowTemplateInput,
            ),
        ),
        (
            "upsert_media_node",
            StructuredTool.from_function(
                coroutine=upsert_media_node,
                name="upsert_media_node",
                description=(
                    "Create or update a single media node (image|video|text|audio) with a prompt. "
                    "Does not start generation — use propose_generation after the node is ready."
                ),
                args_schema=UpsertMediaNodeInput,
            ),
        ),
        (
            "propose_generation",
            StructuredTool.from_function(
                coroutine=propose_generation,
                name="propose_generation",
                description=(
                    "Mark a media node pending user confirm for generation. "
                    "Never calls run_*; wait for the user to confirm in the UI."
                ),
                args_schema=NodeIdInput,
            ),
        ),
        (
            "connect_nodes",
            StructuredTool.from_function(
                coroutine=connect_nodes,
                name="connect_nodes",
                description=(
                    "Connect canvas nodes with directed edges "
                    f"(max {CONNECT_NODES_MAX_EDGES} edges per call)"
                ),
                args_schema=ConnectNodesInput,
            ),
        ),
        (
            "set_node_prompt",
            StructuredTool.from_function(
                coroutine=set_node_prompt,
                name="set_node_prompt",
                description="Update the prompt text on an existing node",
                args_schema=SetNodePromptInput,
            ),
        ),
        (
            "set_node_content",
            StructuredTool.from_function(
                coroutine=set_node_content,
                name="set_node_content",
                description="Update the content text on an existing node",
                args_schema=SetNodeContentInput,
            ),
        ),
        (
            "attach_refs",
            StructuredTool.from_function(
                coroutine=attach_refs,
                name="attach_refs",
                description="Attach ordered reference nodes to a target node",
                args_schema=AttachRefsInput,
            ),
        ),
        (
            "run_image_generation",
            StructuredTool.from_function(
                coroutine=run_image_generation,
                name="run_image_generation",
                description="Run image generation for a canvas node and wait for completion",
                args_schema=NodeIdInput,
            ),
        ),
        (
            "get_generation_status",
            StructuredTool.from_function(
                coroutine=get_generation_status,
                name="get_generation_status",
                description="Poll generation status for a canvas node",
                args_schema=NodeIdInput,
            ),
        ),
        (
            "get_generation_diagnostic",
            StructuredTool.from_function(
                coroutine=get_generation_diagnostic,
                name="get_generation_diagnostic",
                description="Fetch failure/fallback diagnostic for a generation record or node",
                args_schema=GenerationRecordInput,
            ),
        ),
        (
            "cancel_generation",
            StructuredTool.from_function(
                coroutine=cancel_generation,
                name="cancel_generation",
                description="Cancel an in-progress generation by record id or node id",
                args_schema=GenerationRecordInput,
            ),
        ),
        (
            "confirm_platform_fallback",
            StructuredTool.from_function(
                coroutine=confirm_platform_fallback,
                name="confirm_platform_fallback",
                description="Confirm platform fallback billing and retry after BYOK failure",
                args_schema=GenerationRecordInput,
            ),
        ),
        (
            "cancel_platform_fallback",
            StructuredTool.from_function(
                coroutine=cancel_platform_fallback,
                name="cancel_platform_fallback",
                description="Decline platform fallback and mark generation failed",
                args_schema=GenerationRecordInput,
            ),
        ),
        (
            "list_generation_tasks",
            StructuredTool.from_function(
                coroutine=list_generation_tasks,
                name="list_generation_tasks",
                description="List generation records for the current session (task panel)",
                args_schema=ListGenerationTasksInput,
            ),
        ),
        (
            "list_user_assets",
            StructuredTool.from_function(
                coroutine=list_user_assets,
                name="list_user_assets",
                description="List assets in the user's asset library",
            ),
        ),
        (
            "list_public_assets",
            StructuredTool.from_function(
                coroutine=list_public_assets,
                name="list_public_assets",
                description="List platform public assets",
                args_schema=ListPublicAssetsInput,
            ),
        ),
        (
            "save_node_to_asset_library",
            StructuredTool.from_function(
                coroutine=save_node_to_asset_library,
                name="save_node_to_asset_library",
                description="Save a canvas node's media URL to the user asset library",
                args_schema=SaveNodeAssetInput,
            ),
        ),
        (
            "introduce_nodes_to_agent",
            StructuredTool.from_function(
                coroutine=introduce_nodes_to_agent,
                name="introduce_nodes_to_agent",
                description="Add canvas node content to agent sidebar context",
                args_schema=IntroduceNodesInput,
            ),
        ),
        (
            "apply_asset_to_node",
            StructuredTool.from_function(
                coroutine=apply_asset_to_node,
                name="apply_asset_to_node",
                description="Apply a user or public asset URL to a compatible canvas node",
                args_schema=ApplyAssetInput,
            ),
        ),
        (
            "focus_node",
            StructuredTool.from_function(
                coroutine=focus_node,
                name="focus_node",
                description="Pan/zoom the canvas viewport to a node (UI command)",
                args_schema=NodeIdInput,
            ),
        ),
        (
            "apply_sidebar_attachments",
            StructuredTool.from_function(
                coroutine=apply_sidebar_attachments,
                name="apply_sidebar_attachments",
                description="Write sidebar attachments onto canvas nodes (localRefs or ref edges)",
                args_schema=ApplySidebarAttachmentsInput,
            ),
        ),
        (
            "focus_nodes",
            StructuredTool.from_function(
                coroutine=focus_nodes,
                name="focus_nodes",
                description="Pan/zoom the canvas viewport to multiple nodes (UI command)",
                args_schema=FocusNodesInput,
            ),
        ),
        (
            "undo",
            StructuredTool.from_function(
                coroutine=undo,
                name="undo",
                description="Undo the last local canvas edit (client undo stack)",
            ),
        ),
        (
            "redo",
            StructuredTool.from_function(
                coroutine=redo,
                name="redo",
                description="Redo the last undone canvas edit (client undo stack)",
            ),
        ),
        (
            "open_image_editor",
            StructuredTool.from_function(
                coroutine=open_image_editor,
                name="open_image_editor",
                description="Open the image refine editor for a node (UI command)",
                args_schema=OpenImageEditorInput,
            ),
        ),
        (
            "get_canvas_layout",
            StructuredTool.from_function(
                coroutine=get_canvas_layout,
                name="get_canvas_layout",
                description="List canvas node positions, sizes, and group hierarchy",
            ),
        ),
        (
            "duplicate_node",
            StructuredTool.from_function(
                coroutine=duplicate_node,
                name="duplicate_node",
                description=(
                    "Duplicate canvas node(s). Default: copy nodes only, no edges. "
                    "Use node_ids for multi-select. "
                    "Set include_upstream=true to reuse existing upstream nodes and connect them to the copies via inbound edges (edges only, upstream nodes are not duplicated)."
                ),
                args_schema=DuplicateNodeInput,
            ),
        ),
        (
            "upload_media_to_canvas",
            StructuredTool.from_function(
                coroutine=upload_media_to_canvas,
                name="upload_media_to_canvas",
                description="Add a media node from a public URL",
                args_schema=UploadMediaInput,
            ),
        ),
        (
            "export_media_package",
            StructuredTool.from_function(
                coroutine=export_media_package,
                name="export_media_package",
                description=(
                    "Export the selected canvas subgraph (or full canvas when node_ids is empty) "
                    "as a workflow zip package (graph JSON + media files) to the user's browser downloads. "
                    "Returns a manifest and triggers the browser download "
                    "(do not claim the zip is already saved until the browser finishes; "
                    "do not paste markdown Bearer/stream-download links or media-list-only framing as a substitute)."
                ),
                args_schema=ExportMediaInput,
            ),
        ),
        (
            "get_image_edit_capabilities",
            StructuredTool.from_function(
                coroutine=get_image_edit_capabilities,
                name="get_image_edit_capabilities",
                description="Check whether a node supports image refine modes",
                args_schema=NodeIdInput,
            ),
        ),
        (
            "group_nodes",
            StructuredTool.from_function(
                coroutine=group_nodes,
                name="group_nodes",
                description="Wrap nodes in a group container (graph batch)",
                args_schema=GroupNodesInput,
            ),
        ),
        (
            "ungroup_node",
            StructuredTool.from_function(
                coroutine=ungroup_node,
                name="ungroup_node",
                description="Dissolve a group node and restore child positions",
                args_schema=UngroupNodeInput,
            ),
        ),
        (
            "arrange_nodes_grid",
            StructuredTool.from_function(
                coroutine=arrange_nodes_grid,
                name="arrange_nodes_grid",
                description="Arrange nodes in a grid layout (graph batch)",
                args_schema=ArrangeNodesGridInput,
            ),
        ),
        (
            "move_nodes",
            StructuredTool.from_function(
                coroutine=move_nodes,
                name="move_nodes",
                description="Move canvas nodes to absolute coordinates (graph batch)",
                args_schema=MoveNodesInput,
            ),
        ),
        (
            "apply_layout_ops",
            StructuredTool.from_function(
                coroutine=apply_layout_ops,
                name="apply_layout_ops",
                description=(
                    "Apply ordered layout workflow ops (group/ungroup/grid/move) atomically"
                ),
                args_schema=ApplyLayoutOpsInput,
            ),
        ),
    ]
    return specs


def _meta_tool_search() -> StructuredTool:
    """Default meta tool (no-op load); explore replaces with same-turn callback."""
    return make_tool_search_tool(on_loaded=lambda _names: None)


def build_explore_tools(client: NestCanvasClient) -> list[StructuredTool]:
    """Tools bindable in explore sub-graph (read + light write + lifecycle + meta)."""
    tools = [tool for name, tool in _all_tool_specs(client) if name in EXPLORE_TOOL_NAMES]
    tools.append(_meta_tool_search())
    return tools


def build_explore_tools_subset(
    client: NestCanvasClient,
    names: frozenset[str],
) -> list[StructuredTool]:
    """Build a filtered explore tool list (plan / test helper)."""
    allowed = names & EXPLORE_TOOL_NAMES
    by_name = {name: tool for name, tool in _all_tool_specs(client) if name in allowed}
    tools = [by_name[n] for n in sorted(by_name)]
    if "tool_search" in allowed:
        tools.append(_meta_tool_search())
    return tools


def build_canvas_tools(client: NestCanvasClient) -> list[StructuredTool]:
    """All canvas tools — used by tests and future graph tool nodes."""
    tools = [tool for _, tool in _all_tool_specs(client)]
    tools.append(_meta_tool_search())
    return tools


def build_graph_only_tools(client: NestCanvasClient) -> list[StructuredTool]:
    """Generation / destructive tools reserved for deterministic graph paths."""
    return [tool for name, tool in _all_tool_specs(client) if not is_explore_tool(name)]
