<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { apiUrl } from '@/services/api-base'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  canvasActions: [actions: unknown[]]
}>()

const agent = useAgentStore()
const auth = useAuthStore()
const input = ref('')
const chatContainer = ref<HTMLElement>()

async function loadHistory() {
  try {
    const res = await fetch(apiUrl(`/api/agent/chat/user/messages?sessionId=${props.sessionId}`))
    const json = await res.json()
    if (json.data?.length) agent.loadHistory(json.data)
  } catch {
    // ignore
  }
}

async function send() {
  if (!input.value.trim() || agent.isStreaming) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }

  const message = input.value.trim()
  input.value = ''
  agent.addUserMessage(message)
  agent.isStreaming = true
  agent.startAssistantMessage()

  await nextTick()
  scrollToBottom()

  try {
    const token = localStorage.getItem('token')
    const res = await fetch(apiUrl('/api/agent/chat/conversation'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId: props.sessionId, message }),
    })

    const reader = res.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        try {
          const event = JSON.parse(line.slice(6))
          handleEvent(event)
        } catch {
          // skip
        }
      }
    }
  } catch (err) {
    agent.appendText(`\n\n⚠️ 请求失败: ${err}`)
  } finally {
    agent.finishStreaming()
    const actions = agent.flushActions()
    if (actions.length) emit('canvasActions', actions)
    scrollToBottom()
  }
}

function handleEvent(event: { type: string; data: unknown }) {
  switch (event.type) {
    case 'text_delta':
      agent.appendText((event.data as { text: string }).text)
      scrollToBottom()
      break
    case 'tool_call':
      agent.addToolCall((event.data as { name: string }).name)
      break
    case 'tool_result':
      agent.addToolCall(
        (event.data as { name: string }).name,
        (event.data as { result: unknown }).result,
      )
      break
    case 'canvas_action':
      agent.addCanvasAction(event.data as Parameters<typeof agent.addCanvasAction>[0])
      break
    case 'error':
      agent.appendText(`\n\n⚠️ ${(event.data as { message: string }).message}`)
      break
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

onMounted(loadHistory)
</script>

<template>
  <div class="flex h-full flex-col border-l border-white/5 bg-[#1a1a1a]">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/5 px-4 py-3">
      <div>
        <h3 class="text-sm font-medium">AI 创作助手</h3>
        <p class="text-[10px] text-white/40">Agent 驱动画布</p>
      </div>
      <div class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600/30">
        <svg class="h-3.5 w-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
    </div>

    <!-- Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="!agent.messages.length" class="flex h-full items-center justify-center">
        <div class="text-center text-white/30">
          <p class="text-sm">告诉我你想创作什么</p>
          <p class="mt-1 text-xs">我会自动在画布上创建分镜和素材</p>
        </div>
      </div>

      <div
        v-for="msg in agent.messages"
        :key="msg.id"
        class="flex"
        :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
          :class="msg.role === 'user'
            ? 'bg-[#6366f1] text-white'
            : 'bg-[#242424] text-white/80'"
        >
          <p class="whitespace-pre-wrap">{{ msg.content }}<span v-if="msg.streaming" class="animate-pulse">▊</span></p>

          <div v-if="msg.toolCalls?.length" class="mt-2 space-y-1 border-t border-white/10 pt-2">
            <div
              v-for="(tc, i) in msg.toolCalls"
              :key="i"
              class="flex items-center gap-1.5 text-[10px] text-[#818cf8]"
            >
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {{ tc.name }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="border-t border-white/5 p-3">
      <div class="flex gap-2">
        <textarea
          v-model="input"
          class="input-field min-h-[40px] flex-1 resize-none text-sm"
          rows="2"
          placeholder="描述你的创作需求..."
          :disabled="agent.isStreaming"
          @keydown.meta.enter="send"
          @keydown.ctrl.enter="send"
        />
        <button
          class="btn-primary shrink-0 self-end px-4"
          :disabled="!input.trim() || agent.isStreaming"
          @click="send"
        >
          <svg v-if="agent.isStreaming" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
