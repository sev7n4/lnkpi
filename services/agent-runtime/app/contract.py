"""Pydantic models for Nest internal canvas tool endpoints.

These models mirror the Zod schemas defined in packages/shared/src/agentContract.ts
to ensure type-safe contracts between agent-runtime and apps/server.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


# ============================================================
# 基础类型定义
# ============================================================


class Position(BaseModel):
    """Canvas position (x, y)."""

    x: float
    y: float


class CanvasActionPayload(BaseModel):
    """Payload for canvas actions."""

    id: Optional[str] = None
    nodeType: Optional[str] = None
    position: Optional[Position] = None
    data: Optional[dict[str, Any]] = None
    source: Optional[str] = None
    target: Optional[str] = None
    parentShotId: Optional[str] = None
    viewport: Optional[dict[str, float]] = None


class CanvasAction(BaseModel):
    """Canvas action (add_node, update_node, etc.)."""

    type: Literal["add_node", "update_node", "remove_node", "add_edge", "remove_edge", "set_viewport"]
    payload: CanvasActionPayload


# ============================================================
# upsert_prompt_node
# ============================================================


class UpsertPromptNodeRequest(BaseModel):
    """Request for upsert_prompt_node endpoint."""

    sessionId: str
    userId: str
    prompt: str
    content: str
    nodeId: Optional[str] = None
    stage: Optional[bool] = None


class UpsertPromptNodeResponse(BaseModel):
    """Response for upsert_prompt_node endpoint."""

    nodeId: str
    actions: list[CanvasAction]


# ============================================================
# get_node
# ============================================================


class GetNodeRequest(BaseModel):
    """Request for get_node endpoint."""

    sessionId: str
    nodeId: str


class CanvasNode(BaseModel):
    """Canvas node."""

    id: str
    type: str
    position: Position
    data: dict[str, Any]


GetNodeResponse = CanvasNode


# ============================================================
# get_canvas_summary (Phase C)
# ============================================================


class CanvasSummaryNode(BaseModel):
    id: str
    type: str
    title: str
    status: str


class GetCanvasSummaryRequest(BaseModel):
    sessionId: str


class GetCanvasSummaryResponse(BaseModel):
    nodes: list[CanvasSummaryNode]


# ============================================================
# add_nodes_batch
# ============================================================


class AddNodesBatchItem(BaseModel):
    """Item in add_nodes_batch request."""

    key: str
    title: str
    targetType: str
    prompt: Optional[str] = None
    position: Optional[Position] = None


class AddNodesBatchRequest(BaseModel):
    """Request for add_nodes_batch endpoint."""

    sessionId: str
    userId: str
    items: list[AddNodesBatchItem]
    stage: Optional[bool] = None


class AddNodesBatchResponseNode(BaseModel):
    """Node mapping in add_nodes_batch response."""

    key: str
    nodeId: str


class AddNodesBatchResponse(BaseModel):
    """Response for add_nodes_batch endpoint."""

    nodes: list[AddNodesBatchResponseNode]
    actions: list[CanvasAction]


# ============================================================
# connect_nodes
# ============================================================


class ConnectNodesEdge(BaseModel):
    """Edge in connect_nodes request."""

    source: str
    target: str


class ConnectNodesRequest(BaseModel):
    """Request for connect_nodes endpoint."""

    sessionId: str
    edges: list[ConnectNodesEdge]
    stage: Optional[bool] = None


class ConnectNodesResponse(BaseModel):
    """Response for connect_nodes endpoint."""

    actions: list[CanvasAction]


# ============================================================
# set_node_prompt
# ============================================================


class SetNodePromptRequest(BaseModel):
    """Request for set_node_prompt endpoint."""

    sessionId: str
    nodeId: str
    prompt: str
    title: Optional[str] = None
    stage: Optional[bool] = None


class SetNodePromptResponse(BaseModel):
    """Response for set_node_prompt endpoint."""

    actions: list[CanvasAction]


# ============================================================
# set_node_content
# ============================================================


class SetNodeContentRequest(BaseModel):
    """Request for set_node_content endpoint."""

    sessionId: str
    userId: str
    nodeId: str
    content: str
    stage: Optional[bool] = None


class SetNodeContentResponse(BaseModel):
    """Response for set_node_content endpoint."""

    actions: list[CanvasAction]


# ============================================================
# attach_refs
# ============================================================


class AttachRefsRequest(BaseModel):
    """Request for attach_refs endpoint."""

    sessionId: str
    nodeId: str
    refOrder: list[str]


class AttachRefsResponse(BaseModel):
    """Response for attach_refs endpoint."""

    actions: list[CanvasAction]


# ============================================================
# run_image_generation
# ============================================================


class RunImageGenerationRequest(BaseModel):
    """Request for run_image_generation endpoint."""

    sessionId: str
    userId: str
    nodeId: str


class RunImageGenerationResponse(BaseModel):
    """Response for run_image_generation endpoint."""

    url: Optional[str] = None
    status: str
    generationRecordId: Optional[str] = None
    actions: list[CanvasAction]


# ============================================================
# start_image_generation / wait_image_generation (W11)
# ============================================================


class StartImageGenerationRequest(BaseModel):
    """Request for start_image_generation endpoint."""

    sessionId: str
    userId: str
    nodeId: str


class StartImageGenerationResponse(BaseModel):
    """Response for start_image_generation endpoint."""

    status: str
    generationRecordId: str
    actions: list[CanvasAction]


class WaitImageGenerationRequest(BaseModel):
    """Request for wait_image_generation endpoint."""

    sessionId: str
    userId: str
    nodeId: str
    generationRecordId: str


class WaitImageGenerationResponse(BaseModel):
    """Response for wait_image_generation endpoint."""

    url: Optional[str] = None
    status: str
    generationRecordId: Optional[str] = None
    actions: list[CanvasAction]


# ============================================================
# run_video_generation
# ============================================================


class RunVideoGenerationRequest(BaseModel):
    """Request for run_video_generation endpoint."""

    sessionId: str
    userId: str
    nodeId: str


class RunVideoGenerationResponse(BaseModel):
    """Response for run_video_generation endpoint."""

    url: Optional[str] = None
    status: str
    actions: list[CanvasAction]


# ============================================================
# get_generation_status
# ============================================================


class GetGenerationStatusRequest(BaseModel):
    """Request for get_generation_status endpoint."""

    sessionId: str
    nodeId: str


class GetGenerationStatusResponse(BaseModel):
    """Response for get_generation_status endpoint."""

    status: str
    url: Optional[str] = None


# ============================================================
# get_agent_messages
# ============================================================


class GetAgentMessagesRequest(BaseModel):
    """Request for get_agent_messages endpoint."""

    sessionId: str


class AgentMessage(BaseModel):
    """Agent chat message."""

    id: str
    role: str
    content: str
    toolCalls: Optional[str] = None
    createdAt: Union[datetime, str]


GetAgentMessagesResponse = list[AgentMessage]


# ============================================================
# save_agent_message
# ============================================================


class SaveAgentMessageRequest(BaseModel):
    """Request for save_agent_message endpoint."""

    sessionId: str
    userId: str
    role: str
    content: str
    toolCalls: Optional[str] = None


class SaveAgentMessageResponse(BaseModel):
    """Response for save_agent_message endpoint."""

    id: str


# ============================================================
# remove_nodes (W31)
# ============================================================


class RemoveNodesRequest(BaseModel):
    """Request for remove_nodes endpoint."""

    sessionId: str
    nodeIds: list[str]


class RemoveNodesResponse(BaseModel):
    """Response for remove_nodes endpoint."""

    actions: list[CanvasAction]


# ============================================================
# remove_edges (W32)
# ============================================================


class RemoveEdgesRequest(BaseModel):
    """Request for remove_edges endpoint."""

    sessionId: str
    edgeIds: list[str]


class RemoveEdgesResponse(BaseModel):
    """Response for remove_edges endpoint."""

    actions: list[CanvasAction]


# ============================================================
# thread_lock (W7)
# ============================================================


class AcquireThreadLockRequest(BaseModel):
    """Request for acquire_thread_lock endpoint."""

    threadId: str
    holderId: str
    ttlSeconds: Optional[int] = None


class AcquireThreadLockResponse(BaseModel):
    """Response for acquire_thread_lock endpoint."""

    acquired: bool


class RenewThreadLockRequest(BaseModel):
    """Request for renew_thread_lock endpoint."""

    threadId: str
    holderId: str
    ttlSeconds: Optional[int] = None


class RenewThreadLockResponse(BaseModel):
    """Response for renew_thread_lock endpoint."""

    renewed: bool


class ReleaseThreadLockRequest(BaseModel):
    """Request for release_thread_lock endpoint."""

    threadId: str
    holderId: str


class ReleaseThreadLockResponse(BaseModel):
    """Response for release_thread_lock endpoint."""

    released: bool


# ============================================================
# canvas_stage (W8)
# ============================================================


class StageCanvasActionsRequest(BaseModel):
    """Request for stage_canvas_actions endpoint."""

    sessionId: str
    actions: list[CanvasAction]


class StageCanvasActionsResponse(BaseModel):
    """Response for stage_canvas_actions endpoint."""

    stagedCount: int


class CommitStageRequest(BaseModel):
    """Request for commit_stage endpoint."""

    sessionId: str


class CommitStageResponse(BaseModel):
    """Response for commit_stage endpoint."""

    actions: list[CanvasAction]


class RollbackStageRequest(BaseModel):
    """Request for rollback_stage endpoint."""

    sessionId: str


class RollbackStageResponse(BaseModel):
    """Response for rollback_stage endpoint."""

    cleared: bool


# ============================================================
# gen_progress (W15)
# ============================================================


class GetGenProgressRequest(BaseModel):
    """Request for get_gen_progress endpoint."""

    threadId: str


class GetGenProgressResponse(BaseModel):
    """Response for get_gen_progress endpoint."""

    id: str
    lines: str
    summary: Optional[str] = None


class SaveGenProgressRequest(BaseModel):
    """Request for save_gen_progress endpoint."""

    threadId: str
    sessionId: str
    lines: str
    summary: Optional[str] = None


class SaveGenProgressResponse(BaseModel):
    """Response for save_gen_progress endpoint."""

    id: str


# ============================================================
# context_snapshot (W18)
# ============================================================


class GetContextSnapshotRequest(BaseModel):
    """Request for get_context_snapshot endpoint."""

    threadId: str
    stage: Optional[str] = None


class GetContextSnapshotResponse(BaseModel):
    """Response for get_context_snapshot endpoint."""

    id: str
    stage: str
    brief: Optional[str] = None
    planSummary: Optional[str] = None
    manifestJson: Optional[str] = None
    messageCount: Optional[int] = None


class SaveContextSnapshotRequest(BaseModel):
    """Request for save_context_snapshot endpoint."""

    threadId: str
    sessionId: str
    stage: str
    brief: Optional[str] = None
    planSummary: Optional[str] = None
    manifestJson: Optional[str] = None
    messageCount: Optional[int] = None


class SaveContextSnapshotResponse(BaseModel):
    """Response for save_context_snapshot endpoint."""

    id: str