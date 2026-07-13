<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
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
const hovered = ref(false)
const pinned = ref(false)
const expanded = ref(false)

onMounted(() => {
  void loadHistory()
})

function onMouseEnter() {
  hovered.value = true
  expanded.value = true
}

function onMouseLeave() {
  hovered.value = false
  if (!pinned.value) expanded.value = false
}

function togglePin() {
  pinned.value = !pinned.value
  expanded.value = pinned.value || hovered.value
}

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
  expanded.value = true
  pinned.value = true

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
          handleEvent(JSON.parse(line.slice(6)))
        } catch { /* skip */ }
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
</script>

<template>
  <div
    class="agent-floating-dock fixed right-3 top-[88px] z-[55]"
    :class="expanded ? 'is-expanded' : 'is-collapsed'"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="agent-shell flex overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a1a]/98 shadow-2xl backdrop-blur-xl">
      <button
        type="button"
        class="agent-logo-rail flex shrink-0 flex-col items-center gap-2 border-r border-white/5 px-2 py-3"
        :title="expanded ? 'AI 创作助手' : '悬停展开 AI 助手'"
        @click="togglePin"
      >
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] shadow-lg shadow-[#6366f1]/25">
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span v-if="!expanded" class="text-[9px] text-white/40 [writing-mode:vertical-rl]">AI</span>
      </button>

      <div
        v-show="expanded"
        class="agent-panel flex w-[360px] flex-col"
        style="height: min(680px, calc(100vh - 140px))"
      >
        <div class="flex items-center justify-between border-b border-white/5 px-3 py-2.5">
          <div>
            <h3 class="text-sm font-medium">AI 创作助手</h3>
            <p class="text-[10px] text-white/40">悬停展开 · 点击 Logo 固定</p>
          </div>
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-xs"
            :class="pinned ? 'bg-[#6366f1]/25 text-[#818cf8]' : 'text-white/40 hover:bg-white/5'"
            @click="togglePin"
          >
            {{ pinned ? '已固定' : '固定' }}
          </button>
        </div>

        <div ref="chatContainer" class="min-h-0 flex-1 overflow-y-auto space-y-3 p-3">
          <div v-if="!agent.messages.length" class="py-12 text-center text-white/30">
            <p class="text-sm">告诉我你想创作什么</p>
            <p class="mt-1 text-xs">我会自动在画布上创建节点</p>
          </div>
          <div
            v-for="msg in agent.messages"
            :key="msg.id"
            class="flex"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
              :class="msg.role === 'user' ? 'bg-[#6366f1] text-white' : 'bg-[#242424] text-white/80'"
            >
              <p class="whitespace-pre-wrap">{{ msg.content }}<span v-if="msg.streaming" class="animate-pulse">▊</span></p>
              <div v-if="msg.toolCalls?.length" class="mt-1 space-y-0.5 border-t border-white/10 pt-1">
                <div v-for="(tc, i) in msg.toolCalls" :key="i" class="text-[10px] text-[#818cf8]">⚙ {{ tc.name }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-white/5 p-2.5">
          <div class="flex gap-2">
            <textarea
              v-model="input"
              class="input-field min-h-[40px] flex-1 resize-none text-sm"
              rows="2"
              placeholder="描述创作需求..."
              :disabled="agent.isStreaming"
              @keydown.meta.enter="send"
              @keydown.ctrl.enter="send"
            />
            <button class="btn-primary shrink-0 self-end px-3.5" :disabled="!input.trim() || agent.isStreaming" @click="send">
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-shell {
  transition: width 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.is-collapsed .agent-shell {
  width: 48px;
}

.is-expanded .agent-shell {
  width: 408px;
}

.agent-logo-rail {
  width: 48px;
  background: rgba(255, 255, 255, 0.02);
}
</style>
