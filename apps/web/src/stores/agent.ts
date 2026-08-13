import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  type AgentChatMessage,
  type CanvasAction,
  LinkedCanvasOutputSchema,
  type LinkedCanvasOutput,
  type SidebarAttachment,
  validateSidebarAttachments,
} from '@lnkpi/shared'
import { parsePersistedToolCalls } from '@/components/agent/agentCanvasOutputs'
import {
  applyCanvasAction,
  applyExplore,
  applyJourneyUpdate,
  applyNodeStatus,
  applyPhaseHint,
  applyStep,
  applyStructuredError,
  applyTaskUpdate,
  applyTextReplaceStage,
  applyThinking,
  applyToolCall,
  createExecutionTrace,
  finalizeExecutionTrace,
  type ExecutionTraceState,
} from '@/components/agent/executionTraceReducer'
import type { AgentMessageMetadata, JourneyTraceSnapshot } from '@/components/agent/journeyTraceTypes'

export interface AgentStreamMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; result?: unknown }>
  streaming?: boolean
  textReplaceHistory?: string[]
  executionTrace?: ExecutionTraceState
  journeyTrace?: JourneyTraceSnapshot
  attachments?: SidebarAttachment[]
  attachmentRefKeys?: string[]
  linkedOutputs?: LinkedCanvasOutput[]
  canvasActions?: CanvasAction[]
}

type PersistedAgentMessage = AgentChatMessage & { linkedOutputs?: string | null }

export const useAgentStore = defineStore('agent', () => {
  const messages = ref<AgentStreamMessage[]>([])
  const isStreaming = ref(false)
  const pendingActions = ref<CanvasAction[]>([])

  function lastAssistant(): AgentStreamMessage | undefined {
    return [...messages.value].reverse().find((m) => m.role === 'assistant')
  }

  function ensureExecutionTrace() {
    const last = lastAssistant()
    if (!last) return
    if (!last.executionTrace) {
      last.executionTrace = createExecutionTrace()
    }
  }

  function addUserMessage(
    content: string,
    extras?: { attachments?: SidebarAttachment[]; attachmentRefKeys?: string[] },
  ) {
    messages.value.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      attachments: extras?.attachments?.map((attachment) => ({ ...attachment })),
      attachmentRefKeys: extras?.attachmentRefKeys ? [...extras.attachmentRefKeys] : undefined,
    })
  }

  function startAssistantMessage() {
    const msg: AgentStreamMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: '',
      toolCalls: [],
      streaming: true,
      textReplaceHistory: [],
      executionTrace: createExecutionTrace(),
    }
    messages.value.push(msg)
    return msg
  }

  function appendText(text: string) {
    const last = lastAssistant()
    if (last) {
      last.content += text
    }
  }

  function replaceAssistantText(text: string) {
    const last = lastAssistant()
    if (!last) return
    last.textReplaceHistory = [...(last.textReplaceHistory ?? []), text]
    last.content = text
    ensureExecutionTrace()
    if (last.executionTrace) {
      applyTextReplaceStage(last.executionTrace, text)
    }
  }

  function addToolCall(name: string, result?: unknown) {
    const last = lastAssistant()
    if (last) {
      last.toolCalls?.push({ name, result })
      ensureExecutionTrace()
      if (last.executionTrace) {
        applyToolCall(last.executionTrace, name, result)
      }
    }
  }

  function trackCanvasAction(action: CanvasAction) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) {
      applyCanvasAction(last.executionTrace, action)
    }
  }

  function trackNodeStatus(data: { nodeId: string; status: string; url?: string }) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) {
      applyNodeStatus(last.executionTrace, data)
    }
  }

  function trackTaskUpdate(data: {
    id: string
    status: string
    title?: string
    nodeId?: string
    errorHint?: string
    errorCode?: string
  }) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) {
      applyTaskUpdate(last.executionTrace, data)
    }
  }

  function trackStep(data: Parameters<typeof applyStep>[1]) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) applyStep(last.executionTrace, data)
  }

  function trackPhaseHint(data: { phase?: string; label: string }) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) applyPhaseHint(last.executionTrace, data)
  }

  function trackStructuredError(data: Parameters<typeof applyStructuredError>[1]) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) applyStructuredError(last.executionTrace, data)
  }

  function trackThinking(data: { status: string; summary?: string }) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) applyThinking(last.executionTrace, data)
  }

  function trackExplore(data: Parameters<typeof applyExplore>[1]) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) applyExplore(last.executionTrace, data)
  }

  function trackJourneyUpdate(snapshot: JourneyTraceSnapshot) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (!last) return
    last.journeyTrace = snapshot
    if (last.executionTrace) {
      applyJourneyUpdate(last.executionTrace, snapshot)
    }
  }

  function addCanvasAction(action: CanvasAction) {
    trackCanvasAction(action)
    pendingActions.value.push(action)
  }

  function flushActions(): CanvasAction[] {
    const actions = [...pendingActions.value]
    pendingActions.value = []
    return actions
  }

  function finishStreaming() {
    const last = lastAssistant()
    if (last?.executionTrace) {
      finalizeExecutionTrace(last.executionTrace)
    }
    if (last) last.streaming = false
    isStreaming.value = false
  }

  function parseAttachments(raw: string | undefined): SidebarAttachment[] | undefined {
    if (!raw) return undefined
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? validateSidebarAttachments(parsed) : undefined
    } catch {
      return undefined
    }
  }

  function parseLinkedOutputs(raw: string | undefined | null): LinkedCanvasOutput[] | undefined {
    if (!raw) return undefined
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return undefined
      const outputs: LinkedCanvasOutput[] = []
      for (const item of parsed) {
        const result = LinkedCanvasOutputSchema.safeParse(item)
        if (result.success) outputs.push(result.data)
      }
      return outputs.length > 0 ? outputs : undefined
    } catch {
      return undefined
    }
  }

  function parseMessageMetadata(raw: string | undefined): AgentMessageMetadata | undefined {
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as AgentMessageMetadata
    } catch {
      return undefined
    }
  }

  function restoreExecutionTrace(meta: AgentMessageMetadata | undefined): ExecutionTraceState | undefined {
    const raw = meta?.executionTrace as ExecutionTraceState | undefined
    if (!raw?.steps?.length) return undefined
    return {
      steps: raw.steps,
      collapsed: raw.collapsed ?? true,
      turnStartedAt: raw.turnStartedAt ?? Date.now(),
      turnEndedAt: raw.turnEndedAt,
      totalMs: raw.totalMs,
    }
  }

  function loadHistory(history: AgentChatMessage[]) {
    messages.value = history.map((m) => {
      const persisted = m as PersistedAgentMessage
      const meta = parseMessageMetadata(persisted.metadata)
      let executionTrace = restoreExecutionTrace(meta)
      const journeyTrace = meta?.journeyTrace
      if (journeyTrace) {
        if (!executionTrace) {
          executionTrace = createExecutionTrace()
        }
        applyJourneyUpdate(executionTrace, journeyTrace)
      }
      return {
        id: persisted.id,
        role: persisted.role as 'user' | 'assistant',
        content: persisted.content,
        attachments: parseAttachments(persisted.attachments),
        linkedOutputs: parseLinkedOutputs(persisted.linkedOutputs),
        canvasActions: parsePersistedToolCalls(persisted.toolCalls),
        executionTrace,
        journeyTrace,
      }
    })
  }

  function clear() {
    messages.value = []
    pendingActions.value = []
  }

  return {
    messages,
    isStreaming,
    pendingActions,
    addUserMessage,
    startAssistantMessage,
    appendText,
    replaceAssistantText,
    addToolCall,
    trackNodeStatus,
    trackTaskUpdate,
    trackStep,
    trackPhaseHint,
    trackStructuredError,
    trackThinking,
    trackExplore,
    trackJourneyUpdate,
    addCanvasAction,
    flushActions,
    finishStreaming,
    loadHistory,
    clear,
  }
})
