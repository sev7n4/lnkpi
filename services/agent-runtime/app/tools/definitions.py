from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from app.tools.nest_client import NestCanvasClient


class UpsertPromptNodeInput(BaseModel):
    prompt: str = Field(description="Prompt title for the node")
    content: str = Field(description="Markdown content for the prompt node")
    node_id: str | None = Field(default=None, description="Existing node id to update")


class NodeIdInput(BaseModel):
    node_id: str = Field(description="Canvas node id")


class AddNodesBatchInput(BaseModel):
    items: list[dict[str, Any]] = Field(
        description="Batch node specs with key, title, targetType, optional prompt/position"
    )


class ConnectNodesInput(BaseModel):
    edges: list[dict[str, str]] = Field(description="Directed edges as source/target node ids")


class SetNodePromptInput(BaseModel):
    node_id: str = Field(description="Canvas node id")
    prompt: str = Field(description="Updated prompt text")


class AttachRefsInput(BaseModel):
    node_id: str = Field(description="Target node id")
    ref_order: list[str] = Field(description="Ordered reference node ids")


def build_canvas_tools(client: NestCanvasClient) -> list[StructuredTool]:
    """Build LangChain tools with session/user injected via the Nest client."""

    async def upsert_prompt_node(prompt: str, content: str, node_id: str | None = None) -> dict:
        return await client.upsert_prompt_node(prompt=prompt, content=content, node_id=node_id)

    async def get_node(node_id: str) -> dict:
        return await client.get_node(node_id)

    async def add_nodes_batch(items: list[dict[str, Any]]) -> dict:
        return await client.add_nodes_batch(items)

    async def connect_nodes(edges: list[dict[str, str]]) -> dict:
        return await client.connect_nodes(edges)

    async def set_node_prompt(node_id: str, prompt: str) -> dict:
        return await client.set_node_prompt(node_id, prompt)

    async def attach_refs(node_id: str, ref_order: list[str]) -> dict:
        return await client.attach_refs(node_id, ref_order)

    async def run_image_generation(node_id: str) -> dict:
        return await client.run_image_generation(node_id)

    async def get_generation_status(node_id: str) -> dict:
        return await client.get_generation_status(node_id)

    return [
        StructuredTool.from_function(
            coroutine=upsert_prompt_node,
            name="upsert_prompt_node",
            description="Create or update a prompt node on the canvas",
            args_schema=UpsertPromptNodeInput,
        ),
        StructuredTool.from_function(
            coroutine=get_node,
            name="get_node",
            description="Fetch a canvas node snapshot by id",
            args_schema=NodeIdInput,
        ),
        StructuredTool.from_function(
            coroutine=add_nodes_batch,
            name="add_nodes_batch",
            description="Add multiple canvas nodes in one batch",
            args_schema=AddNodesBatchInput,
        ),
        StructuredTool.from_function(
            coroutine=connect_nodes,
            name="connect_nodes",
            description="Connect canvas nodes with directed edges",
            args_schema=ConnectNodesInput,
        ),
        StructuredTool.from_function(
            coroutine=set_node_prompt,
            name="set_node_prompt",
            description="Update the prompt text on an existing node",
            args_schema=SetNodePromptInput,
        ),
        StructuredTool.from_function(
            coroutine=attach_refs,
            name="attach_refs",
            description="Attach ordered reference nodes to a target node",
            args_schema=AttachRefsInput,
        ),
        StructuredTool.from_function(
            coroutine=run_image_generation,
            name="run_image_generation",
            description="Run image generation for a canvas node and wait for completion",
            args_schema=NodeIdInput,
        ),
        StructuredTool.from_function(
            coroutine=get_generation_status,
            name="get_generation_status",
            description="Poll image generation status for a canvas node",
            args_schema=NodeIdInput,
        ),
    ]
