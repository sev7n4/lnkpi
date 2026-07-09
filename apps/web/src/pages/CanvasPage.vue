<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, type Node, type Edge, type Connection, type NodeTypesObject } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { Session } from '@lnkpi/shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import CanvasNodePrompt from '@/components/canvas/CanvasNodePrompt.vue'
import CanvasNodeImage from '@/components/canvas/CanvasNodeImage.vue'
import CanvasNodeVideo from '@/components/canvas/CanvasNodeVideo.vue'
import CanvasNodeText from '@/components/canvas/CanvasNodeText.vue'
import GenerationBar from '@/components/canvas/GenerationBar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const sessionId = computed(() => route.params.sessionId as string)

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const sessionTitle = ref('未命名画布')
const saving = ref(false)
const showSessions = ref(false)
const sessions = ref<Session[]>([])
let nodeCounter = 0

const nodeTypes = {
  prompt: CanvasNodePrompt,
  image: CanvasNodeImage,
  video: CanvasNodeVideo,
  text: CanvasNodeText,
}

function onConnect(connection: Connection) {
  edges.value.push({
    id: `e-${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
    animated: true,
    style: { stroke: '#7c3aed' },
  })
}

function addNode(type: string, data: Record<string, unknown> = {}) {
  nodeCounter++
  nodes.value.push({
    id: `${type}-${nodeCounter}`,
    type,
    position: { x: 200 + nodeCounter * 60, y: 150 + nodeCounter * 40 },
    data,
  })
}

async function saveCanvas() {
  saving.value = true
  try {
    await api.put(`/sessions/${sessionId.value}`, {
      title: sessionTitle.value,
      canvasData: { nodes: nodes.value, edges: edges.value },
    })
  } catch {
    // demo mode
  } finally {
    saving.value = false
  }
}

async function loadSession() {
  try {
    const { data } = await api.get<{ data: { title: string; canvasData?: { nodes: Node[]; edges: Edge[] } } }>(
      `/sessions/${sessionId.value}`,
    )
    sessionTitle.value = data.data.title
    if (data.data.canvasData?.nodes?.length) {
      nodes.value = data.data.canvasData.nodes
      edges.value = data.data.canvasData.edges ?? []
      nodeCounter = nodes.value.length
    } else {
      nodes.value = [{
        id: 'prompt-1',
        type: 'prompt',
        position: { x: 250, y: 100 },
        data: { prompt: '描述你的创意场景...' },
      }]
      nodeCounter = 1
    }
  } catch {
    nodes.value = [{
      id: 'prompt-1',
      type: 'prompt',
      position: { x: 250, y: 100 },
      data: { prompt: '描述你的创意场景...' },
    }]
    nodeCounter = 1
  }
}

async function loadSessions() {
  if (!auth.isLoggedIn) return
  try {
    const { data } = await api.get<{ data: Session[] }>('/sessions')
    sessions.value = data.data
  } catch {
    // ignore
  }
}

function handleGenerate(payload: { prompt: string }) {
  addNode('image', { url: '', status: 'generating', prompt: payload.prompt })
  const node = nodes.value[nodes.value.length - 1]
  setTimeout(() => {
    node.data = {
      ...node.data,
      status: 'completed',
      url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80',
    }
  }, 2000)
}

function switchSession(id: string) {
  router.push(`/workflow/${id}`)
  showSessions.value = false
}

onMounted(() => {
  loadSession()
  loadSessions()
})
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)]">
    <!-- Session Sidebar -->
    <aside
      class="flex w-64 shrink-0 flex-col border-r border-white/5 bg-surface-card transition-all"
      :class="showSessions ? '' : 'w-0 overflow-hidden border-0'"
    >
      <div class="flex items-center justify-between border-b border-white/5 p-3">
        <span class="text-xs font-medium text-white/60">我的画布</span>
        <button class="text-xs text-brand-400" @click="router.push('/workflow')">+ 新建</button>
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <button
          v-for="s in sessions"
          :key="s.id"
          class="mb-1 w-full rounded-lg px-3 py-2 text-left text-xs transition hover:bg-white/5"
          :class="s.id === sessionId ? 'bg-brand-600/20 text-brand-300' : 'text-white/60'"
          @click="switchSession(s.id)"
        >
          {{ s.title }}
        </button>
      </div>
    </aside>

    <div class="flex flex-1 flex-col">
      <!-- Toolbar -->
      <div class="flex items-center justify-between border-b border-white/5 bg-surface-card px-4 py-2">
        <div class="flex items-center gap-3">
          <button class="btn-ghost text-xs" @click="router.push('/workflow')">← 返回</button>
          <button class="btn-ghost text-xs" @click="showSessions = !showSessions">会话</button>
          <input
            v-model="sessionTitle"
            class="rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-white/10 focus:border-brand-500/50"
          />
        </div>

        <div class="flex items-center gap-2">
          <button class="btn-ghost text-xs" @click="addNode('prompt', { prompt: '' })">+ 提示词</button>
          <button class="btn-ghost text-xs" @click="addNode('image', { url: '', status: 'idle' })">+ 图像</button>
          <button class="btn-ghost text-xs" @click="addNode('video', { url: '', status: 'idle' })">+ 视频</button>
          <button class="btn-ghost text-xs" @click="addNode('text', { content: '文本节点' })">+ 文本</button>
          <button class="btn-ghost text-xs">分镜</button>
          <button class="btn-primary text-xs" :disabled="saving" @click="saveCanvas">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>

      <!-- Canvas -->
      <div class="relative flex-1">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="(nodeTypes as NodeTypesObject)"
          :default-viewport="{ zoom: 1, x: 0, y: 0 }"
          :min-zoom="0.1"
          :max-zoom="2"
          fit-view-on-init
          class="canvas-flow"
          @connect="onConnect"
        >
          <Background pattern-color="#2a2a3a" :gap="20" />
          <Controls />
          <MiniMap :node-color="() => '#7c3aed'" mask-color="rgba(15, 15, 20, 0.8)" />
        </VueFlow>
      </div>

      <!-- Generation Bar (对标 NeoWOW 底部生成栏) -->
      <GenerationBar @generate="handleGenerate" />
    </div>
  </div>
</template>

<style scoped>
.canvas-flow {
  background: #0a0a0f;
}

:deep(.vue-flow__controls) {
  background: rgba(22, 22, 31, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
}

:deep(.vue-flow__controls-button) {
  background: transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: white;
  fill: white;
}

:deep(.vue-flow__minimap) {
  background: rgba(22, 22, 31, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}
</style>
