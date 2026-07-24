import type { CanvasAction, CanvasData, Shot } from '@lnkpi/shared'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: AgentToolCall[]
  toolCallId?: string
  createdAt: string
}

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AgentToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  }
}

export interface AgentContext {
  sessionId: string
  canvasData: CanvasData
  shots: Shot[]
  userMessage: string
  history: AgentMessage[]
}

export interface AgentStreamEvent {
  type:
    | 'text_delta'
    | 'tool_call'
    | 'tool_result'
    | 'canvas_action'
    | 'node_status'
    | 'done'
    | 'error'
  data: unknown
}

export interface LLMProvider {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools: AgentToolDefinition[],
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void>
}

export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>, ctx: AgentContext): Promise<{
    result: unknown
    actions: CanvasAction[]
  }>
}
