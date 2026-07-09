<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { CanvasAction } from '@lnkpi/shared'
import { api } from '@/services/api'
import { applyActionsToFlow, type FlowEdge, type FlowNode } from '@/composables/useCanvasActions'
import CanvasNodePrompt from '@/components/canvas/CanvasNodePrompt.vue'
import CanvasNodeImage from '@/components/canvas/CanvasNodeImage.vue'
import CanvasNodeVideo from '@/components/canvas/CanvasNodeVideo.vue'
import CanvasNodeText from '@/components/canvas/CanvasNodeText.vue'
import CanvasNodeShot from '@/components/canvas/CanvasNodeShot.vue'

interface AgentMessage {
  id: string
  role: string
  content: string
  toolCalls?: string | null
  createdAt: string
}

interface ReplayStep {
  id: string
  label: string
  role: 'user' | 'assistant' | 'action'
  actions: CanvasAction[]
}

const route = useRoute()
const router = useRouter()
const sessionId = computed(() => route.params.sessionId as string)

const sessionTitle = ref('创作回放')
const steps = ref<ReplayStep[]>([])
const currentStep = ref(0)
const playing = ref(false)
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
let playTimer: ReturnType<typeof setInterval> | null = null

const nodeTypes = {
  prompt: CanvasNodePrompt,
  image: CanvasNodeImage,
  video: CanvasNodeVideo,
  text: CanvasNodeText,
  shot: CanvasNodeShot,
}

function rebuildCanvas(upToStep: number) {
  let n = nodes.value as unknown as FlowNode[]
  let e = edges.value as unknown as FlowEdge[]
  for (let i = 0; i <= upToStep; i++) {
    const step = steps.value[i]
    if (!step?.actions.length) continue
    const result = applyActionsToFlow(n, e, step.actions)
    n = result.nodes
    e = result.edges
  }
  nodes.value = n as unknown as Node[]
  edges.value = e as unknown as Edge[]
}

function togglePlay() {
  playing.value = !playing.value
  if (playing.value) {
    playTimer = setInterval(() => {
      if (currentStep.value >= steps.value.length - 1) {
        playing.value = false
        if (playTimer) clearInterval(playTimer)
        return
      }
      currentStep.value++
      rebuildCanvas(currentStep.value)
    }, 1200)
  } else if (playTimer) {
    clearInterval(playTimer)
  }
}

function goToStep(index: number) {
  currentStep.value = index
  rebuildCanvas(index)
  playing.value = false
  if (playTimer) clearInterval(playTimer)
}

async function loadReplay() {
  const [sessionRes, msgRes] = await Promise.all([
    api.get<{ data: { title: string } }>(`/sessions/${sessionId.value}`),
    api.get<{ data: AgentMessage[] }>(`/agent/chat/user/messages?sessionId=${sessionId.value}`),
  ])
  sessionTitle.value = sessionRes.data.data.title

  const built: ReplayStep[] = []
  for (const msg of msgRes.data.data) {
    if (msg.role === 'user') {
      built.push({ id: msg.id, label: msg.content, role: 'user', actions: [] })
    }
    if (msg.role === 'assistant') {
      let actions: CanvasAction[] = []
      if (msg.toolCalls) {
        try {
          actions = JSON.parse(msg.toolCalls) as CanvasAction[]
        } catch {
          actions = []
        }
      }
      if (msg.content || actions.length) {
        built.push({
          id: msg.id,
          label: msg.content || '画布更新',
          role: actions.length ? 'action' : 'assistant',
          actions,
        })
      }
    }
  }
  steps.value = built
  currentStep.value = built.length ? built.length - 1 : 0
  rebuildCanvas(currentStep.value)
}

onMounted(loadReplay)
onUnmounted(() => { if (playTimer) clearInterval(playTimer) })
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)]">
    <aside class="flex w-[300px] shrink-0 flex-col border-r border-white/5 bg-[#1a1a1a]">
      <div class="border-b border-white/5 p-4">
        <button class="btn-ghost mb-2 text-xs" @click="router.push(`/workflow/${sessionId}`)">← 返回画布</button>
        <h2 class="text-sm font-medium">{{ sessionTitle }}</h2>
        <p class="mt-1 text-xs text-white/40">创作过程回放</p>
        <div class="mt-3 flex gap-2">
          <button class="btn-primary flex-1 py-1.5 text-xs" @click="togglePlay">
            {{ playing ? '暂停' : '播放' }}
          </button>
          <button class="btn-ghost py-1.5 text-xs" @click="goToStep(0)">重置</button>
        </div>
      </div>
      <ol class="flex-1 overflow-y-auto p-3">
        <li
          v-for="(step, idx) in steps"
          :key="step.id"
          class="mb-2 cursor-pointer rounded-lg border px-3 py-2 text-xs transition"
          :class="idx === currentStep
            ? 'border-[#6366f1]/50 bg-[#6366f1]/15 text-[#818cf8]'
            : 'border-white/5 text-white/60 hover:bg-white/5'"
          @click="goToStep(idx)"
        >
          <span class="text-[10px] uppercase text-white/30">{{ step.role }}</span>
          <p class="mt-1 line-clamp-3">{{ step.label }}</p>
        </li>
        <li v-if="!steps.length" class="px-3 py-6 text-center text-xs text-white/30">
          暂无 Agent 对话记录
        </li>
      </ol>
    </aside>

    <div class="relative flex-1">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes as any"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        fit-view-on-init
        class="canvas-flow h-full"
      >
        <Background pattern-color="#2a2a3a" :gap="20" />
      </VueFlow>
    </div>
  </div>
</template>

<style scoped>
.canvas-flow {
  background: #141414;
}
</style>
