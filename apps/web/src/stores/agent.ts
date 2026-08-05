import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentChatMessage, CanvasAction } from '@lnkpi/shared'
import {
  applyCanvasAction,
  applyNodeStatus,
  applyTaskUpdate,
  applyTextReplaceStage,
  applyToolCall,
  createExecutionTrace,
  finalizeExecutionTrace,
  type ExecutionTraceState,
} from '@/components/agent/executionTraceReducer'

export interface AgentStreamMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; result?: unknown }>
  streaming?: boolean
  textReplaceHistory?: string[]
  executionTrace?: ExecutionTraceState
}

export const useAgentStore = defineStore('agent', () => {
  const messages = ref<AgentStreamMessage[]>([])
  const isStreaming = ref(false)
  const pendingActions = ref<CanvasAction[]>([])

  function lastAssistant(): AgentStreamMessage | undefined {
    const last = messages.value[messages.value.length - 1]
    return last?.role === 'assistant' ? last : undefined
  }

  function ensureExecutionTrace() {
    const last = lastAssistant()
    if (!last) return
    if (!last.executionTrace) {
      last.executionTrace = createExecutionTrace()
    }
  }

  function addUserMessage(content: string) {
    messages.value.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
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
  }) {
    ensureExecutionTrace()
    const last = lastAssistant()
    if (last?.executionTrace) {
      applyTaskUpdate(last.executionTrace, data)
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

  function loadHistory(history: AgentChatMessage[]) {
    messages.value = history.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
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
    addCanvasAction,
    flushActions,
    finishStreaming,
    loadHistory,
    clear,
  }
})
