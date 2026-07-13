<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { apiUrl } from '@/services/api-base'
import NeoAgentLogo from '@/components/agent/NeoAgentLogo.vue'

const props = defineProps<{
  sessionId: string
}>()

const emit = defineEmits<{
  canvasActions: [actions: unknown[]]
  expandedChange: [expanded: boolean]
}>()

const agent = useAgentStore()
const auth = useAuthStore()
const input = ref('')
const chatContainer = ref<HTMLElement>()
const hovered = ref(false)
const pinned = ref(false)
const expanded = ref(false)

const RAIL_W = 56
const PANEL_W = 392

onMounted(() => {
  void loadHistory()
})

function setExpanded(value: boolean) {
  expanded.value = value
  emit('expandedChange', value)
}

function onMouseEnter() {
  hovered.value = true
  setExpanded(true)
}

function onMouseLeave() {
  hovered.value = false
  if (!pinned.value) setExpanded(false)
}

function togglePin() {
  pinned.value = !pinned.value
  setExpanded(pinned.value || hovered.value)
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
  setExpanded(true)
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

function openPanel() {
  pinned.value = true
  setExpanded(true)
}

defineExpose({ openPanel })
</script>

<template>
  <aside
    class="agent-side-rail shrink-0 overflow-hidden border-l border-white/[0.06] bg-[#141414] transition-[width] duration-300 ease-out"
    :style="{ width: `${expanded ? PANEL_W : RAIL_W}px` }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="flex h-full min-h-0">
      <!-- Logo 触发条（Neo GeminiChatAgent 入口，始终可见） -->
      <button
        type="button"
        class="agent-logo-trigger flex w-14 shrink-0 flex-col items-center gap-2 border-r border-white/[0.04] py-4"
        title="悬停展开 AI 助手"
        @click="togglePin"
      >
        <NeoAgentLogo :active="expanded || pinned" />
        <span v-if="!expanded" class="text-[9px] tracking-widest text-white/30 [writing-mode:vertical-rl]">AGENT</span>
      </button>

      <!-- 展开面板：挤压画布而非浮层 -->
      <div
        v-show="expanded"
        class="flex min-w-0 flex-1 flex-col"
        :style="{ width: `${PANEL_W - RAIL_W}px` }"
      >
        <div class="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
          <div>
            <h3 class="text-[13px] font-medium text-white/90">Gemini 创作助手</h3>
            <p class="text-[10px] text-white/35">Neo Chat Agent</p>
          </div>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-[10px]"
            :class="pinned ? 'bg-[#6366f1]/20 text-[#818cf8]' : 'text-white/40 hover:bg-white/5'"
            @click="togglePin"
          >
            {{ pinned ? '已固定' : '固定' }}
          </button>
        </div>

        <div ref="chatContainer" class="min-h-0 flex-1 overflow-y-auto space-y-3 px-3 py-3">
          <div v-if="!agent.messages.length" class="py-10 text-center text-white/30">
            <p class="text-sm">描述你的创意</p>
            <p class="mt-1 text-[11px] text-white/25">我会驱动画布创建节点</p>
          </div>
          <div
            v-for="msg in agent.messages"
            :key="msg.id"
            class="flex"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[94%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed"
              :class="msg.role === 'user' ? 'bg-[#6366f1] text-white' : 'bg-[#1f1f1f] text-white/80'"
            >
              <p class="whitespace-pre-wrap">{{ msg.content }}<span v-if="msg.streaming" class="animate-pulse">▊</span></p>
              <div v-if="msg.toolCalls?.length" class="mt-1 space-y-0.5 border-t border-white/10 pt-1">
                <div v-for="(tc, i) in msg.toolCalls" :key="i" class="text-[10px] text-[#818cf8]">⚙ {{ tc.name }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-white/[0.06] p-2.5">
          <div class="flex gap-2">
            <textarea
              v-model="input"
              class="input-field min-h-[44px] flex-1 resize-none text-[13px]"
              rows="2"
              placeholder="输入创作指令..."
              :disabled="agent.isStreaming"
              @keydown.meta.enter="send"
              @keydown.ctrl.enter="send"
            />
            <button class="btn-primary shrink-0 self-end px-3.5 py-2" :disabled="!input.trim() || agent.isStreaming" @click="send">
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
