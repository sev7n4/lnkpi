import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgentChatMessage, CanvasAction } from '@lnkpi/shared'

export interface AgentStreamMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; result?: unknown }>
  streaming?: boolean
}

export const useAgentStore = defineStore('agent', () => {
  const messages = ref<AgentStreamMessage[]>([])
  const isStreaming = ref(false)
  const pendingActions = ref<CanvasAction[]>([])

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
    }
    messages.value.push(msg)
    return msg
  }

  function appendText(text: string) {
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant') {
      last.content += text
    }
  }

  function addToolCall(name: string, result?: unknown) {
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant') {
      last.toolCalls?.push({ name, result })
    }
  }

  function addCanvasAction(action: CanvasAction) {
    pendingActions.value.push(action)
  }

  function flushActions(): CanvasAction[] {
    const actions = [...pendingActions.value]
    pendingActions.value = []
    return actions
  }

  function finishStreaming() {
    const last = messages.value[messages.value.length - 1]
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
    addToolCall,
    addCanvasAction,
    flushActions,
    finishStreaming,
    loadHistory,
    clear,
  }
})
