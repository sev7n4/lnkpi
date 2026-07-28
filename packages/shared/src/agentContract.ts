import { z } from 'zod'

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
  actions: z.array(CanvasActionSchema),
})

export type RunImageGenerationResponse = z.infer<typeof RunImageGenerationResponseSchema>

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

export const GetAgentMessagesRequestSchema = z.object({
  sessionId: z.string(),
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