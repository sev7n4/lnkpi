<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { apiUrl } from '@/services/api-base'
import NeoAgentLogo from '@/components/agent/NeoAgentLogo.vue'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import { useClickOutside } from '@/composables/useClickOutside'
import { estimateTextCredits } from '@/constants/credits'

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

/** 面板是否展开（收缩态只保留右下角 logo FAB） */
const open = ref(false)
/** 浮动窗口模式：面板脱离侧栏，悬浮在画布上，可拖拽 */
const floating = ref(false)

/* ---- 宽度：默认可容纳 dock 底部参数一排，支持拖拉调宽 ---- */
const PANEL_MIN_W = 420
const PANEL_MAX_W = 760
const PANEL_DEFAULT_W = 500
const panelWidth = ref(PANEL_DEFAULT_W)
const resizing = ref(false)

/* ---- 浮窗位置 / 尺寸 ---- */
const floatPos = ref({ x: 0, y: 0 })
const floatWidth = ref(PANEL_DEFAULT_W)
const dragging = ref(false)

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

const { getConfig } = useModelProviderSettings()
const agentModel = ref(getConfig('text').model)
const speech = useSpeechRecognition()
const credits = estimateTextCredits()

/* ---- 技能选择 ---- */
interface AgentSkill {
  id: string
  label: string
  desc: string
  icon: 'canvas' | 'storyboard' | 'polish' | 'organize'
}

const AGENT_SKILLS: AgentSkill[] = [
  { id: 'canvas', label: '画布编排', desc: '创建节点与连线，驱动画布创作', icon: 'canvas' },
  { id: 'storyboard', label: '分镜脚本', desc: '拆解剧情，生成分镜与镜头描述', icon: 'storyboard' },
  { id: 'polish', label: '提示词优化', desc: '润色扩写提示词，提升生成质量', icon: 'polish' },
  { id: 'organize', label: '素材整理', desc: '归纳画布素材，梳理创作结构', icon: 'organize' },
]

const activeSkillId = ref('canvas')
const activeSkill = computed(() => AGENT_SKILLS.find((s) => s.id === activeSkillId.value) ?? AGENT_SKILLS[0])
const skillMenuOpen = ref(false)
const skillMenuRef = ref<HTMLElement | null>(null)
useClickOutside(skillMenuRef, () => {
  skillMenuOpen.value = false
})

/* ---- 历史记录 ---- */
const historyOpen = ref(false)
const historyRef = ref<HTMLElement | null>(null)
useClickOutside(historyRef, () => {
  historyOpen.value = false
})

const historyPrompts = computed(() =>
  agent.messages
    .filter((m) => m.role === 'user')
    .slice(-30)
    .reverse(),
)

function applyHistoryPrompt(content: string) {
  input.value = content
  historyOpen.value = false
}

onMounted(() => {
  void loadHistory()
})

function openPanel() {
  open.value = true
  emit('expandedChange', true)
}

function closePanel() {
  open.value = false
  emit('expandedChange', false)
}

function toggleFloating() {
  floating.value = !floating.value
  if (floating.value) {
    // 首次浮出时把面板放到画布右侧默认位置
    floatWidth.value = clamp(panelWidth.value, PANEL_MIN_W, window.innerWidth - 48)
    floatPos.value = {
      x: Math.max(16, window.innerWidth - floatWidth.value - 40),
      y: 56,
    }
  }
}

/* ---- 浮窗拖拽（按住头部空白处移动） ---- */
function startDrag(event: MouseEvent) {
  if (!floating.value) return
  if ((event.target as HTMLElement).closest('button, input, textarea')) return
  event.preventDefault()
  dragging.value = true
  const offsetX = event.clientX - floatPos.value.x
  const offsetY = event.clientY - floatPos.value.y
  const onMove = (ev: MouseEvent) => {
    floatPos.value = {
      x: clamp(ev.clientX - offsetX, -floatWidth.value + 120, window.innerWidth - 120),
      y: clamp(ev.clientY - offsetY, 0, window.innerHeight - 64),
    }
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/* ---- 左边缘拖拉调宽（侧栏 / 浮窗通用） ---- */
function startResize(event: MouseEvent) {
  event.preventDefault()
  resizing.value = true
  const floatRight = floatPos.value.x + floatWidth.value
  const onMove = (ev: MouseEvent) => {
    if (floating.value) {
      const width = clamp(floatRight - ev.clientX, PANEL_MIN_W, PANEL_MAX_W)
      floatWidth.value = width
      floatPos.value = { ...floatPos.value, x: floatRight - width }
    } else {
      panelWidth.value = clamp(window.innerWidth - ev.clientX, PANEL_MIN_W, PANEL_MAX_W)
    }
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function newAgentSession() {
  agent.clear()
  input.value = ''
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

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (isFinal) {
      input.value = input.value ? `${input.value} ${text}` : text
    }
  })
}

async function send() {
  if (!input.value.trim() || agent.isStreaming) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }

  const skillPrefix = activeSkillId.value === 'canvas' ? '' : `【技能：${activeSkill.value.label}】`
  const message = `${skillPrefix}${input.value.trim()}`
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
      body: JSON.stringify({ sessionId: props.sessionId, message, model: agentModel.value }),
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

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void send()
  }
}

defineExpose({ openPanel })
</script>

<template>
  <aside
    class="agent-side-rail shrink-0 overflow-visible"
    :class="{ 'is-resizing': resizing, 'is-docked-open': open && !floating }"
    :style="{ width: open && !floating ? `${panelWidth}px` : '0px' }"
  >
    <div class="flex h-full min-h-0">
      <!-- 收缩态：右下角 agent logo 悬浮按钮 -->
      <Teleport to="body">
        <button
          v-if="!open"
          type="button"
          class="agent-fab"
          title="打开 AI 助手"
          @click="openPanel"
        >
          <NeoAgentLogo size="sm" />
        </button>
      </Teleport>

      <!-- 面板：侧栏内嵌 or 浮动窗口（Teleport 到 body） -->
      <Teleport to="body" :disabled="!floating">
        <div
          v-show="open"
          class="agent-panel-shell flex min-w-0 flex-col"
          :class="[
            floating ? 'agent-panel-floating' : 'agent-panel-inline flex-1',
            { 'is-dragging': dragging },
          ]"
          :style="floating ? {
            left: `${floatPos.x}px`,
            top: `${floatPos.y}px`,
            width: `${floatWidth}px`,
          } : undefined"
        >
          <!-- 左边缘拖拉调宽 -->
          <div class="agent-resize-handle" title="拖拉调整宽度" @mousedown="startResize" />

          <!-- 顶栏：logo + 新建 / 历史 / 浮窗切换 / 收起（浮窗模式可按住拖动） -->
          <div
            class="agent-panel-header flex items-center justify-between px-3 py-2"
            :class="floating ? 'cursor-move' : ''"
            @mousedown="startDrag"
          >
            <div class="flex min-w-0 items-center gap-2">
              <NeoAgentLogo size="xs" active />
              <p class="agent-subtitle truncate text-[11px]">lnk·π agent</p>
            </div>
            <div class="flex items-center gap-0.5">
              <!-- 新建 agent 会话 -->
              <button type="button" class="agent-head-btn" title="新建对话" @click="newAgentSession">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <!-- 历史记录 -->
              <div ref="historyRef" class="relative">
                <button
                  type="button"
                  class="agent-head-btn"
                  :class="historyOpen ? 'is-active' : ''"
                  title="历史记录"
                  @click="historyOpen = !historyOpen"
                >
                  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="12" cy="12" r="9" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 2" />
                  </svg>
                </button>
                <div
                  v-if="historyOpen"
                  class="neo-popover absolute right-0 top-full z-20 mt-1.5 max-h-[280px] w-[240px] overflow-y-auto rounded-xl py-1"
                  @click.stop
                >
                  <p class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--neo-text-muted)]">最近指令</p>
                  <button
                    v-for="msg in historyPrompts"
                    :key="msg.id"
                    type="button"
                    class="neo-popover-item block w-full truncate px-3 py-2 text-left text-xs"
                    :title="msg.content"
                    @click="applyHistoryPrompt(msg.content)"
                  >
                    {{ msg.content }}
                  </button>
                  <p v-if="!historyPrompts.length" class="px-3 py-4 text-center text-[11px] text-[var(--neo-text-muted)]">
                    暂无历史指令
                  </p>
                </div>
              </div>

              <!-- 浮动窗口切换：面板脱离/停靠侧栏 -->
              <button
                type="button"
                class="agent-head-btn"
                :class="floating ? 'is-active' : ''"
                :title="floating ? '停靠回侧栏' : '切换为浮动窗口'"
                @click="toggleFloating"
              >
                <!-- 浮窗图标：主窗 + 右上悬浮小窗（带弹出箭头） -->
                <svg v-if="!floating" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H5.5A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H9" />
                  <rect x="12" y="12" width="9" height="8" rx="1.5" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 9.5 13 6m0 0h-2.8M13 6v2.8" transform="translate(-1 1)" />
                </svg>
                <!-- 停靠图标：小窗收回主窗 -->
                <svg v-else viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path stroke-linecap="round" d="M15 4v16M15 12h6" opacity="0.4" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="m11 9-3 3 3 3M8 12h5" />
                </svg>
              </button>

              <!-- 收起：回到右下角 logo -->
              <button type="button" class="agent-head-btn" title="收起助手" @click="closePanel">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 消息列表 -->
          <div ref="chatContainer" class="min-h-0 flex-1 overflow-y-auto space-y-3 px-3 py-3">
            <div v-if="!agent.messages.length" class="agent-empty py-10 text-center">
              <p class="text-sm">描述你的创意</p>
              <p class="mt-1 text-[11px] opacity-70">我会驱动画布创建节点、连线与生成任务</p>
            </div>
            <div
              v-for="msg in agent.messages"
              :key="msg.id"
              class="flex"
              :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <div
                class="agent-bubble max-w-[94%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed"
                :class="msg.role === 'user' ? 'agent-bubble-user' : 'agent-bubble-assistant'"
              >
                <p class="whitespace-pre-wrap">{{ msg.content }}<span v-if="msg.streaming" class="animate-pulse">▊</span></p>
                <div v-if="msg.toolCalls?.length" class="agent-tools mt-1 space-y-0.5 pt-1">
                  <div v-for="(tc, i) in msg.toolCalls" :key="i" class="text-[10px] text-[var(--neo-accent-text)]">⚙ {{ tc.name }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部输入 dock：与节点 dock-studio 同款毛玻璃 -->
          <div class="agent-input-area px-2.5 pb-2.5 pt-1">
            <div class="agent-input-dock">
              <textarea
                v-model="input"
                class="agent-prompt-field"
                rows="3"
                :placeholder="`向${activeSkill.label}助手描述需求，Cmd/Ctrl + Enter 发送...`"
                :disabled="agent.isStreaming"
                @keydown="onKeydown"
              />

              <div class="agent-dock-actions">
                <!-- 模型选择 -->
                <UniversalModelSelector v-model="agentModel" type="text" />

                <!-- 技能选择 -->
                <div ref="skillMenuRef" class="relative">
                  <button
                    type="button"
                    class="neo-ctl flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
                    title="技能"
                    @click="skillMenuOpen = !skillMenuOpen"
                  >
                    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-[var(--neo-accent-text)]" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" />
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
                    </svg>
                    <span class="max-w-[72px] truncate font-medium">{{ activeSkill.label }}</span>
                  </button>
                  <div
                    v-if="skillMenuOpen"
                    class="neo-popover absolute bottom-full left-0 z-30 mb-1 w-[220px] rounded-xl py-1"
                    @click.stop
                  >
                    <button
                      v-for="skill in AGENT_SKILLS"
                      :key="skill.id"
                      type="button"
                      class="neo-popover-item flex w-full items-start gap-2 px-3 py-2 text-left"
                      :class="skill.id === activeSkillId ? '!text-[var(--neo-accent-text)]' : ''"
                      @click="activeSkillId = skill.id; skillMenuOpen = false"
                    >
                      <span class="agent-skill-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                        <svg v-if="skill.icon === 'canvas'" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path stroke-linecap="round" d="M10 6.5h5.5A1.5 1.5 0 0 1 17 8v6" />
                        </svg>
                        <svg v-else-if="skill.icon === 'storyboard'" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 10v9" />
                        </svg>
                        <svg v-else-if="skill.icon === 'polish'" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M14 4l6 6L8 22H2v-6L14 4z" /><path stroke-linecap="round" d="M11 7l6 6" />
                        </svg>
                        <svg v-else viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                        </svg>
                      </span>
                      <span class="min-w-0">
                        <span class="block text-xs font-medium">{{ skill.label }}</span>
                        <span class="block truncate text-[10px] opacity-60">{{ skill.desc }}</span>
                      </span>
                    </button>
                  </div>
                </div>

                <div class="ml-auto flex items-center gap-2">
                  <!-- 积分消耗 -->
                  <DockCreditBadge :credits="credits" />
                  <!-- 语音输入 -->
                  <DockMicButton
                    :listening="speech.listening.value"
                    :disabled="agent.isStreaming"
                    @toggle="toggleVoice"
                  />
                  <!-- 生成 -->
                  <DockGenerateButton
                    :generating="agent.isStreaming"
                    :disabled="!agent.isStreaming && !input.trim()"
                    @generate="send"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
    </div>
  </aside>
</template>

<style scoped>
.agent-side-rail {
  position: relative;
  background: var(--neo-bg);
  transition: width 0.3s ease, background 0.25s ease;
}

.agent-side-rail.is-docked-open {
  border-left: 1px solid var(--neo-border);
}

.agent-side-rail.is-resizing {
  transition: none;
}

/* ---- 收缩态右下角 logo 悬浮按钮 ---- */
.agent-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.agent-fab:hover {
  transform: scale(1.08);
}

/* ---- 面板外壳 ---- */
.agent-panel-inline {
  position: relative;
  background: var(--neo-bg);
}

.agent-panel-floating {
  position: fixed;
  z-index: 60;
  height: min(680px, calc(100vh - 72px));
  max-width: calc(100vw - 32px);
  border: 1px solid var(--neo-glass-border);
  border-radius: 20px;
  background: var(--neo-popover-bg);
  box-shadow: var(--neo-popover-shadow);
  backdrop-filter: blur(28px) saturate(1.4);
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  overflow: hidden;
}

.agent-panel-floating.is-dragging {
  user-select: none;
}

/* ---- 左边缘拖拉调宽 ---- */
.agent-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 5;
  width: 7px;
  cursor: ew-resize;
}

.agent-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}

.agent-resize-handle:hover::after {
  background: var(--neo-accent-border);
}

.agent-panel-floating .agent-resize-handle {
  left: 0;
}

.agent-panel-header {
  border-bottom: 1px solid var(--neo-border);
}

.agent-subtitle {
  color: var(--neo-text-muted);
}

.agent-head-btn {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--neo-text-muted);
  transition: background 0.15s ease, color 0.15s ease;
}

.agent-head-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.agent-head-btn.is-active {
  background: var(--neo-accent-soft);
  color: var(--neo-accent-text);
}

/* ---- 消息气泡 ---- */
.agent-empty {
  color: var(--neo-text-muted);
}

.agent-bubble-user {
  background: var(--neo-brand-gradient);
  color: #fff;
  box-shadow: 0 4px 14px rgba(109, 93, 252, 0.25);
}

.agent-bubble-assistant {
  background: var(--neo-surface-elevated);
  border: 1px solid var(--neo-border);
  color: var(--neo-text-primary);
}

.agent-tools {
  border-top: 1px solid var(--neo-border);
}

/* ---- 底部输入 dock（对齐 dock-studio 毛玻璃） ---- */
.agent-input-dock {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  overflow: visible;
  border: 1px solid var(--neo-glass-border);
  border-radius: 18px;
  background: var(--neo-glass-bg);
  backdrop-filter: blur(var(--neo-glass-blur)) saturate(1.5);
  -webkit-backdrop-filter: blur(var(--neo-glass-blur)) saturate(1.5);
  box-shadow: var(--neo-glass-shadow);
  transition: border-color 0.2s ease;
}

.agent-input-dock::before {
  content: '';
  position: absolute;
  top: 0;
  right: 20px;
  left: 20px;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--neo-glass-topline), transparent);
}

.agent-input-dock:focus-within {
  border-color: var(--neo-accent-border);
}

.agent-prompt-field {
  width: 100%;
  min-height: 76px;
  max-height: 180px;
  resize: none;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  line-height: 1.55;
  color: var(--neo-text-primary);
}

.agent-prompt-field::placeholder {
  color: var(--neo-text-muted);
}

.agent-dock-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--neo-border);
}

.agent-skill-icon {
  background: var(--neo-accent-soft);
  color: var(--neo-accent-text);
}
</style>
