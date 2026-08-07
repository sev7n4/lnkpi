import { z } from 'zod'
import { SidebarAttachmentSchema } from './sidebarAttachments'

// ============================================================
// 基础类型定义
// ============================================================

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type Position = z.infer<typeof PositionSchema>

export const CanvasActionSchema = z.object({
  type: z.enum(['add_node', 'update_node', 'remove_node', 'add_edge', 'remove_edge', 'set_viewport']),
  payload: z.object({
    id: z.string().optional(),
    nodeType: z.string().optional(),
    position: PositionSchema.optional(),
    data: z.record(z.unknown()).optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    parentShotId: z.string().optional(),
    viewport: z
      .object({
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
      })
      .optional(),
  }),
})

export type CanvasAction = z.infer<typeof CanvasActionSchema>

// ============================================================
// upsert_prompt_node
// ============================================================

export const UpsertPromptNodeRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  prompt: z.string(),
  content: z.string(),
  nodeId: z.string().optional(),
  stage: z.boolean().optional(),
})

export type UpsertPromptNodeRequest = z.infer<typeof UpsertPromptNodeRequestSchema>

export const UpsertPromptNodeResponseSchema = z.object({
  nodeId: z.string(),
  actions: z.array(CanvasActionSchema),
})

export type UpsertPromptNodeResponse = z.infer<typeof UpsertPromptNodeResponseSchema>

// ============================================================
// get_node
// ============================================================

export const GetNodeRequestSchema = z.object({
  sessionId: z.string(),
  nodeId: z.string(),
})

export type GetNodeRequest = z.infer<typeof GetNodeRequestSchema>

export const CanvasNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: PositionSchema,
  data: z.record(z.unknown()),
})

export type CanvasNode = z.infer<typeof CanvasNodeSchema>

export const GetNodeResponseSchema = CanvasNodeSchema

export type GetNodeResponse = z.infer<typeof GetNodeResponseSchema>

// ============================================================
// get_canvas_summary (Phase C)
// ============================================================

export const CanvasSummaryNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
})

export type CanvasSummaryNode = z.infer<typeof CanvasSummaryNodeSchema>

export const GetCanvasSummaryRequestSchema = z.object({
  sessionId: z.string(),
})

export type GetCanvasSummaryRequest = z.infer<typeof GetCanvasSummaryRequestSchema>

export const GetCanvasSummaryResponseSchema = z.object({
  nodes: z.array(CanvasSummaryNodeSchema),
})

export type GetCanvasSummaryResponse = z.infer<typeof GetCanvasSummaryResponseSchema>

// ============================================================
// add_nodes_batch
// ============================================================

export const AddNodesBatchItemSchema = z.object({
  key: z.string(),
  title: z.string(),
  targetType: z.string(),
  prompt: z.string().optional(),
  position: PositionSchema.optional(),
})

export type AddNodesBatchItem = z.infer<typeof AddNodesBatchItemSchema>

export const AddNodesBatchRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  items: z.array(AddNodesBatchItemSchema),
  stage: z.boolean().optional(),
})

export type AddNodesBatchRequest = z.infer<typeof AddNodesBatchRequestSchema>

export const AddNodesBatchResponseSchema = z.object({
  nodes: z.array(
    z.object({
      key: z.string(),
      nodeId: z.string(),
    })
  ),
  actions: z.array(CanvasActionSchema),
})

export type AddNodesBatchResponse = z.infer<typeof AddNodesBatchResponseSchema>

// ============================================================
// connect_nodes
// ============================================================

export const ConnectNodesEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
})

export type ConnectNodesEdge = z.infer<typeof ConnectNodesEdgeSchema>

export const ConnectNodesRequestSchema = z.object({
  sessionId: z.string(),
  edges: z.array(ConnectNodesEdgeSchema),
  stage: z.boolean().optional(),
})

export type ConnectNodesRequest = z.infer<typeof ConnectNodesRequestSchema>

export const ConnectNodesResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type ConnectNodesResponse = z.infer<typeof ConnectNodesResponseSchema>

// ============================================================
// set_node_prompt
// ============================================================

export const SetNodePromptRequestSchema = z.object({
  sessionId: z.string(),
  nodeId: z.string(),
  prompt: z.string(),
  title: z.string().optional(),
  stage: z.boolean().optional(),
})

export type SetNodePromptRequest = z.infer<typeof SetNodePromptRequestSchema>

export const SetNodePromptResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type SetNodePromptResponse = z.infer<typeof SetNodePromptResponseSchema>

// ============================================================
// set_node_content
// ============================================================

export const SetNodeContentRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  nodeId: z.string(),
  content: z.string(),
  stage: z.boolean().optional(),
})

export type SetNodeContentRequest = z.infer<typeof SetNodeContentRequestSchema>

export const SetNodeContentResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type SetNodeContentResponse = z.infer<typeof SetNodeContentResponseSchema>

// ============================================================
// attach_refs
// ============================================================

export const AttachRefsRequestSchema = z.object({
  sessionId: z.string(),
  nodeId: z.string(),
  refOrder: z.array(z.string()),
})

export type AttachRefsRequest = z.infer<typeof AttachRefsRequestSchema>

export const AttachRefsResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type AttachRefsResponse = z.infer<typeof AttachRefsResponseSchema>

// ============================================================
// run_image_generation
// ============================================================

export const RunImageGenerationRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  nodeId: z.string(),
})

export type RunImageGenerationRequest = z.infer<typeof RunImageGenerationRequestSchema>

export const RunImageGenerationResponseSchema = z.object({
  url: z.string().optional(),
  status: z.string(),
  generationRecordId: z.string().optional(),
  actions: z.array(CanvasActionSchema),
})

export type RunImageGenerationResponse = z.infer<typeof RunImageGenerationResponseSchema>

// ============================================================
// start_image_generation / wait_image_generation (W11)
// ============================================================

export const StartImageGenerationRequestSchema = RunImageGenerationRequestSchema

export type StartImageGenerationRequest = z.infer<typeof StartImageGenerationRequestSchema>

export const StartImageGenerationResponseSchema = z.object({
  status: z.string(),
  generationRecordId: z.string(),
  actions: z.array(CanvasActionSchema),
})

export type StartImageGenerationResponse = z.infer<typeof StartImageGenerationResponseSchema>

export const WaitImageGenerationRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  nodeId: z.string(),
  generationRecordId: z.string(),
})

export type WaitImageGenerationRequest = z.infer<typeof WaitImageGenerationRequestSchema>

export const WaitImageGenerationResponseSchema = RunImageGenerationResponseSchema

export type WaitImageGenerationResponse = z.infer<typeof WaitImageGenerationResponseSchema>

// ============================================================
// run_video_generation
// ============================================================

export const RunVideoGenerationRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  nodeId: z.string(),
})

export type RunVideoGenerationRequest = z.infer<typeof RunVideoGenerationRequestSchema>

export const RunVideoGenerationResponseSchema = z.object({
  url: z.string().optional(),
  status: z.string(),
  actions: z.array(CanvasActionSchema),
})

export type RunVideoGenerationResponse = z.infer<typeof RunVideoGenerationResponseSchema>

// ============================================================
// get_generation_status
// ============================================================

export const GetGenerationStatusRequestSchema = z.object({
  sessionId: z.string(),
  nodeId: z.string(),
})

export type GetGenerationStatusRequest = z.infer<typeof GetGenerationStatusRequestSchema>

export const GetGenerationStatusResponseSchema = z.object({
  status: z.string(),
  url: z.string().optional(),
})

export type GetGenerationStatusResponse = z.infer<typeof GetGenerationStatusResponseSchema>

// ============================================================
// get_agent_messages
// ============================================================

export const LinkedCanvasOutputSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  nodeType: z.string(),
  status: z.enum(['running', 'done', 'failed']),
})

export type LinkedCanvasOutput = z.infer<typeof LinkedCanvasOutputSchema>

export const AgentThreadSummarySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AgentThreadSummary = z.infer<typeof AgentThreadSummarySchema>

export const GetAgentMessagesQuerySchema = z.object({
  sessionId: z.string(),
  threadId: z.string(),
})

export type GetAgentMessagesQuery = z.infer<typeof GetAgentMessagesQuerySchema>

export const GetAgentMessagesRequestSchema = z.object({
  sessionId: z.string(),
  threadId: z.string(),
})

export type GetAgentMessagesRequest = z.infer<typeof GetAgentMessagesRequestSchema>

export const AgentMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  toolCalls: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]),
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const GetAgentMessagesResponseSchema = z.array(AgentMessageSchema)

export type GetAgentMessagesResponse = z.infer<typeof GetAgentMessagesResponseSchema>

// ============================================================
// save_agent_message
// ============================================================

export const SaveAgentMessageRequestSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  role: z.string(),
  content: z.string(),
  toolCalls: z.string().optional(),
})

export type SaveAgentMessageRequest = z.infer<typeof SaveAgentMessageRequestSchema>

export const SaveAgentMessageResponseSchema = z.object({
  id: z.string(),
})

export type SaveAgentMessageResponse = z.infer<typeof SaveAgentMessageResponseSchema>

// ============================================================
// remove_nodes (W31)
// ============================================================

export const RemoveNodesRequestSchema = z.object({
  sessionId: z.string(),
  nodeIds: z.array(z.string()),
  stage: z.boolean().optional(),
})

export type RemoveNodesRequest = z.infer<typeof RemoveNodesRequestSchema>

export const RemoveNodesResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type RemoveNodesResponse = z.infer<typeof RemoveNodesResponseSchema>

// ============================================================
// remove_edges (W32)
// ============================================================

export const RemoveEdgesRequestSchema = z.object({
  sessionId: z.string(),
  edgeIds: z.array(z.string()),
  stage: z.boolean().optional(),
})

export type RemoveEdgesRequest = z.infer<typeof RemoveEdgesRequestSchema>

export const RemoveEdgesResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type RemoveEdgesResponse = z.infer<typeof RemoveEdgesResponseSchema>

// ============================================================
// thread_lock (W7)
// ============================================================

export const AcquireThreadLockRequestSchema = z.object({
  threadId: z.string(),
  holderId: z.string(),
  ttlSeconds: z.number().optional(),
})

export type AcquireThreadLockRequest = z.infer<typeof AcquireThreadLockRequestSchema>

export const AcquireThreadLockResponseSchema = z.object({
  acquired: z.boolean(),
})

export type AcquireThreadLockResponse = z.infer<typeof AcquireThreadLockResponseSchema>

export const RenewThreadLockRequestSchema = z.object({
  threadId: z.string(),
  holderId: z.string(),
  ttlSeconds: z.number().optional(),
})

export type RenewThreadLockRequest = z.infer<typeof RenewThreadLockRequestSchema>

export const RenewThreadLockResponseSchema = z.object({
  renewed: z.boolean(),
})

export type RenewThreadLockResponse = z.infer<typeof RenewThreadLockResponseSchema>

export const ReleaseThreadLockRequestSchema = z.object({
  threadId: z.string(),
  holderId: z.string(),
})

export type ReleaseThreadLockRequest = z.infer<typeof ReleaseThreadLockRequestSchema>

export const ReleaseThreadLockResponseSchema = z.object({
  released: z.boolean(),
})

export type ReleaseThreadLockResponse = z.infer<typeof ReleaseThreadLockResponseSchema>

// ============================================================
// canvas_stage (W8)
// ============================================================

export const StageCanvasActionsRequestSchema = z.object({
  sessionId: z.string(),
  actions: z.array(CanvasActionSchema),
})

export type StageCanvasActionsRequest = z.infer<typeof StageCanvasActionsRequestSchema>

export const StageCanvasActionsResponseSchema = z.object({
  stagedCount: z.number(),
})

export type StageCanvasActionsResponse = z.infer<typeof StageCanvasActionsResponseSchema>

export const CommitStageRequestSchema = z.object({
  sessionId: z.string(),
})

export type CommitStageRequest = z.infer<typeof CommitStageRequestSchema>

export const CommitStageResponseSchema = z.object({
  actions: z.array(CanvasActionSchema),
})

export type CommitStageResponse = z.infer<typeof CommitStageResponseSchema>

export const RollbackStageRequestSchema = z.object({
  sessionId: z.string(),
})

export type RollbackStageRequest = z.infer<typeof RollbackStageRequestSchema>

export const RollbackStageResponseSchema = z.object({
  cleared: z.boolean(),
})

export type RollbackStageResponse = z.infer<typeof RollbackStageResponseSchema>

// ============================================================
// gen_progress (W15)
// ============================================================

export const GetGenProgressRequestSchema = z.object({
  threadId: z.string(),
})

export type GetGenProgressRequest = z.infer<typeof GetGenProgressRequestSchema>

export const GetGenProgressResponseSchema = z.object({
  id: z.string(),
  lines: z.string(),
  summary: z.string().nullable().optional(),
})

export type GetGenProgressResponse = z.infer<typeof GetGenProgressResponseSchema>

export const SaveGenProgressRequestSchema = z.object({
  threadId: z.string(),
  sessionId: z.string(),
  lines: z.string(),
  summary: z.string().nullable().optional(),
})

export type SaveGenProgressRequest = z.infer<typeof SaveGenProgressRequestSchema>

export const SaveGenProgressResponseSchema = z.object({
  id: z.string(),
})

export type SaveGenProgressResponse = z.infer<typeof SaveGenProgressResponseSchema>

// ============================================================
// context_snapshot (W18)
// ============================================================

export const GetContextSnapshotRequestSchema = z.object({
  threadId: z.string(),
  stage: z.string().optional(),
})

export type GetContextSnapshotRequest = z.infer<typeof GetContextSnapshotRequestSchema>

export const GetContextSnapshotResponseSchema = z.object({
  id: z.string(),
  stage: z.string(),
  brief: z.string().nullable().optional(),
  planSummary: z.string().nullable().optional(),
  manifestJson: z.string().nullable().optional(),
  messageCount: z.number().nullable().optional(),
})

export type GetContextSnapshotResponse = z.infer<typeof GetContextSnapshotResponseSchema>

export const SaveContextSnapshotRequestSchema = z.object({
  threadId: z.string(),
  sessionId: z.string(),
  stage: z.string(),
  brief: z.string().nullable().optional(),
  planSummary: z.string().nullable().optional(),
  manifestJson: z.string().nullable().optional(),
  messageCount: z.number().nullable().optional(),
})

export type SaveContextSnapshotRequest = z.infer<typeof SaveContextSnapshotRequestSchema>

export const SaveContextSnapshotResponseSchema = z.object({
  id: z.string(),
})

export type SaveContextSnapshotResponse = z.infer<typeof SaveContextSnapshotResponseSchema>

// ============================================================
// agent_conversation (sidebar attachments)
// ============================================================

export const AgentConversationRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  threadId: z.string().optional(),
  userDecision: z
    .enum(['confirm', 'revise', 'replan', 'confirm_gen', 'topo_revise', 'node_revise'])
    .optional(),
  skillId: z.string().optional(),
  focusNodeId: z.string().optional(),
  model: z.string().optional(),
  attachments: z.array(SidebarAttachmentSchema).max(5).optional(),
  refOrder: z.array(z.string()).optional(),
  mentionedKeys: z
    .array(z.string().regex(/^[TIVA]\d+$/i))
    .max(5)
    .optional(),
})

export function normalizeMentionedKeys(keys?: string[]): string[] | undefined {
  if (!keys?.length) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of keys) {
    const upper = k.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    out.push(upper)
  }
  return out.length ? out : undefined
}

export type AgentConversationRequest = z.infer<typeof AgentConversationRequestSchema>