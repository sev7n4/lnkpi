<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, type Node, type Edge, type Connection, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { Session, CanvasAction } from '@lnkpi/shared'
import { api } from '@/services/api'
import { canvasApi } from '@/services/canvas-api'
import { studioApi } from '@/services/studio-api'
import { useAuthStore } from '@/stores/auth'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { applyActionsToFlow, flowToCanvasData } from '@/composables/useCanvasActions'
import { useShotPolling } from '@/composables/useShotPolling'
import CanvasNodePrompt from '@/components/canvas/CanvasNodePrompt.vue'
import CanvasNodeImage from '@/components/canvas/CanvasNodeImage.vue'
import CanvasNodeVideo from '@/components/canvas/CanvasNodeVideo.vue'
import CanvasNodeText from '@/components/canvas/CanvasNodeText.vue'
import CanvasNodeShot from '@/components/canvas/CanvasNodeShot.vue'
import GenerationBar from '@/components/canvas/GenerationBar.vue'
import AIImageEditor from '@/components/canvas/AIImageEditor.vue'
import CanvasContextMenu from '@/components/canvas/CanvasContextMenu.vue'
import StoryboardDialog, { type StoryboardShot } from '@/components/canvas/StoryboardDialog.vue'
import PublishNeoTVDialog from '@/components/works/PublishNeoTVDialog.vue'
import AgentPanel from '@/components/agent/AgentPanel.vue'

const PlayCanvasView = defineAsyncComponent(
  () => import('@/canvas/playcanvas/PlayCanvasView.vue'),
)

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canvasEditor = useCanvasEditorStore()
const sessionId = computed(() => route.params.sessionId as string)

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const sessionTitle = ref('未命名画布')
const saving = ref(false)
const showSessions = ref(true)
const showAgent = ref(true)
const canvasMode = ref<'vueflow' | 'playcanvas'>('vueflow')
const showStoryboard = ref(false)
const showPublish = ref(false)
const sessions = ref<Session[]>([])
const contextMenu = ref<{ x: number; y: number; nodeId?: string; nodeType?: string } | null>(null)
let nodeCounter = 0

const shotPolling = useShotPolling((shots) => {
  for (const shot of shots) {
    const material = shot.materials.find((m) => m.status === 'completed' && m.url)
    if (!material) continue
    const shotNode = nodes.value.find((n) => n.id === shot.id)
    if (shotNode) {
      shotNode.data = { ...(shotNode.data as Record<string, unknown>), status: 'generated', coverUrl: material.url }
    }
    const mediaNode = nodes.value.find((n) =>
      (n.type === 'image' || n.type === 'video')
      && edges.value.some((e) => e.source === shot.id && e.target === n.id),
    )
    if (mediaNode) {
      mediaNode.data = { ...(mediaNode.data as Record<string, unknown>), url: material.url, status: 'completed' }
    }
  }
})

function startPollingForGeneratingShots() {
  const generatingIds: string[] = []
  for (const n of nodes.value) {
    if (n.type === 'shot' && (n.data as Record<string, unknown>).status === 'generating') {
      generatingIds.push(n.id)
    }
  }
  if (generatingIds.length) shotPolling.start(generatingIds)
}

const mentionOptions = computed((): Array<{ id: string; label: string; type: string }> => {
  const out: Array<{ id: string; label: string; type: string }> = []
  for (const n of nodes.value) {
    const data = n.data as Record<string, unknown>
    out.push({
      id: n.id,
      label: String(data.title ?? data.prompt ?? n.id),
      type: String(n.type ?? 'node'),
    })
  }
  return out
})

const playCanvasNodes = computed((): Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }> =>
  nodes.value.map((n) => ({
    id: n.id,
    type: String(n.type),
    position: n.position,
    data: n.data as Record<string, unknown>,
  })),
)

const storyboardShots = computed((): StoryboardShot[] => {
  const out: StoryboardShot[] = []
  let order = 0
  for (const n of nodes.value) {
    if (n.type !== 'shot') continue
    const data = n.data as Record<string, unknown>
    out.push({
      id: n.id,
      title: String(data.title ?? '未命名分镜'),
      prompt: data.prompt as string | undefined,
      status: data.status as string | undefined,
      coverUrl: data.coverUrl as string | undefined,
      order: order++,
    })
  }
  return out
})

const nodeTypes = {
  prompt: CanvasNodePrompt,
  image: CanvasNodeImage,
  video: CanvasNodeVideo,
  text: CanvasNodeText,
  shot: CanvasNodeShot,
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

function addNode(
  type: string,
  data: Record<string, unknown> = {},
  opts?: { id?: string; position?: { x: number; y: number } },
) {
  nodeCounter++
  const id = opts?.id ?? `${type}-${nodeCounter}`
  nodes.value.push({
    id,
    type,
    position: opts?.position ?? { x: 200 + nodeCounter * 60, y: 150 + nodeCounter * 40 },
    data,
  })
  return id
}

function handleAgentActions(actions: unknown[]) {
  const result = applyActionsToFlow(
    nodes.value as unknown as import('@/composables/useCanvasActions').FlowNode[],
    edges.value as unknown as import('@/composables/useCanvasActions').FlowEdge[],
    actions as CanvasAction[],
  )
  nodes.value = result.nodes as unknown as Node[]
  edges.value = result.edges as unknown as Edge[]
  startPollingForGeneratingShots()
  void saveCanvas()
}

async function handleGenerate(payload: {
  prompt: string
  mode: 'text' | 'image' | 'video'
  textModel: string
  imageModel: string
  videoModel: string
}) {
  if (!payload.prompt.trim()) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }

  if (payload.mode === 'text') {
    try {
      const { data } = await studioApi.generateText(payload.prompt, payload.textModel)
      const record = data.data
      let content = payload.prompt
      if (record.metadata) {
        try {
          const meta = JSON.parse(record.metadata) as { text?: string }
          content = meta.text ?? content
        } catch { /* ignore */ }
      }
      addNode('text', { content })
      await saveCanvas()
    } catch {
      addNode('text', { content: `（生成失败）${payload.prompt}` })
      await saveCanvas()
    }
    return
  }

  try {
    const shotRes = await canvasApi.createShot(sessionId.value, {
      title: payload.prompt.slice(0, 24) || '新分镜',
      prompt: payload.prompt,
    })
    const shot = shotRes.data.data as {
      id: string
      title: string
      prompt: string
      positionX: number
      positionY: number
    }

    addNode('shot', {
      title: shot.title,
      prompt: shot.prompt,
      status: 'generating',
    }, { id: shot.id, position: { x: shot.positionX, y: shot.positionY } })

    if (payload.mode === 'video') {
      const matRes = await canvasApi.generateVideo(shot.id, payload.prompt)
      const material = matRes.data.data as { id: string }

      addNode('video', {
        url: '',
        status: 'generating',
        prompt: payload.prompt,
      }, { id: material.id, position: { x: shot.positionX + 280, y: shot.positionY } })

      edges.value.push({
        id: `e-${shot.id}-${material.id}`,
        source: shot.id,
        target: material.id,
        animated: true,
        style: { stroke: '#6366f1' },
      })
    } else {
      const matRes = await canvasApi.generateImage(shot.id, payload.prompt)
      const material = matRes.data.data as { id: string }

      addNode('image', {
        url: '',
        status: 'generating',
        prompt: payload.prompt,
      }, { id: material.id, position: { x: shot.positionX + 280, y: shot.positionY } })

      edges.value.push({
        id: `e-${shot.id}-${material.id}`,
        source: shot.id,
        target: material.id,
        animated: true,
        style: { stroke: '#6366f1' },
      })
    }

    shotPolling.start([shot.id])
    await saveCanvas()
  } catch {
    addNode('shot', { title: '新分镜', prompt: payload.prompt, status: 'draft' })
    await saveCanvas()
  }
}

function getEventCoords(event: MouseEvent | TouchEvent) {
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY }
  }
  const touch = event.touches[0] ?? event.changedTouches[0]
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
}

function findNodeById(id: string) {
  for (const node of nodes.value) {
    if (node.id === id) return node
  }
  return null
}

function removeNodeById(id: string) {
  for (let i = nodes.value.length - 1; i >= 0; i -= 1) {
    if (nodes.value[i]?.id === id) nodes.value.splice(i, 1)
  }
  for (let i = edges.value.length - 1; i >= 0; i -= 1) {
    const edge = edges.value[i]
    if (edge?.source === id || edge?.target === id) edges.value.splice(i, 1)
  }
}

function onNodeContextMenu(event: NodeMouseEvent) {
  event.event.preventDefault()
  const { x, y } = getEventCoords(event.event)
  contextMenu.value = {
    x,
    y,
    nodeId: event.node.id,
    nodeType: String(event.node.type),
  }
}

function onPaneContextMenu(event: MouseEvent | TouchEvent) {
  event.preventDefault()
  const { x, y } = getEventCoords(event)
  contextMenu.value = { x, y }
}

function closeContextMenu() {
  contextMenu.value = null
}

function handleContextAction(action: string) {
  const menu = contextMenu.value
  contextMenu.value = null
  if (!menu) return

  if (action === 'edit-image' && menu.nodeId) {
    const node = findNodeById(menu.nodeId)
    if (node?.type === 'image') {
      const data = node.data as Record<string, unknown>
      canvasEditor.openImageEditor({
        nodeId: node.id,
        url: String(data.url ?? ''),
        prompt: data.prompt as string | undefined,
      })
    }
    return
  }

  if (action === 'duplicate' && menu.nodeId) {
    const node = findNodeById(menu.nodeId)
    if (node) {
      addNode(String(node.type), { ...(node.data as Record<string, unknown>) }, {
        position: { x: node.position.x + 40, y: node.position.y + 40 },
      })
      void saveCanvas()
    }
    return
  }

  if (action === 'delete' && menu.nodeId) {
    removeNodeById(menu.nodeId)
    void saveCanvas()
    return
  }

  if (action === 'add-shot') {
    addNode('shot', { title: '新分镜', prompt: '', status: 'draft' })
    void saveCanvas()
  }
}

function handleImageEditorApply(payload: { nodeId: string; url: string; prompt?: string }) {
  const node = findNodeById(payload.nodeId)
  if (node) {
    node.data = {
      ...(node.data as Record<string, unknown>),
      url: payload.url,
      status: 'completed',
      prompt: payload.prompt,
    }
    void saveCanvas()
  }
}

function openPublish() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  showPublish.value = true
}

async function saveCanvas() {
  saving.value = true
  try {
    await api.put(`/sessions/${sessionId.value}`, {
      title: sessionTitle.value,
      canvasData: flowToCanvasData(
        nodes.value as unknown as import('@/composables/useCanvasActions').FlowNode[],
        edges.value as unknown as import('@/composables/useCanvasActions').FlowEdge[],
      ),
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

function switchSession(id: string) {
  router.push(`/workflow/${id}`)
}

onMounted(() => {
  loadSession()
  loadSessions()
})
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)]" @click="closeContextMenu">
    <!-- Left: Session Sidebar (对标 SessionSelector) -->
    <aside
      class="flex shrink-0 flex-col border-r border-white/5 bg-[#1a1a1a] transition-all"
      :class="showSessions ? 'w-[240px]' : 'w-0 overflow-hidden'"
    >
      <div class="flex items-center justify-between border-b border-white/5 p-3">
        <span class="text-xs font-medium text-white/60">我的画布</span>
        <button class="text-xs text-[#818cf8] hover:text-[#6366f1]" @click="router.push('/workflow')">+ 新建</button>
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <button
          v-for="s in sessions"
          :key="s.id"
          class="mb-1 w-full rounded-lg px-3 py-2 text-left text-xs transition hover:bg-white/5"
          :class="s.id === sessionId ? 'bg-[#6366f1]/20 text-[#818cf8]' : 'text-white/60'"
          @click="switchSession(s.id)"
        >
          {{ s.title }}
        </button>
        <p v-if="!sessions.length" class="px-3 py-4 text-center text-[10px] text-white/30">
          登录后查看画布列表
        </p>
      </div>
    </aside>

    <!-- Center: Canvas + Generation Bar -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center justify-between border-b border-white/5 bg-[#1a1a1a] px-4 py-2">
        <div class="flex items-center gap-2">
          <button class="btn-ghost px-2 py-1 text-xs" @click="router.push('/workflow')">←</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="showSessions = !showSessions">会话</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="showAgent = !showAgent">Agent</button>
          <div class="flex rounded-lg border border-white/10 p-0.5">
            <button
              class="rounded-md px-2 py-0.5 text-[10px] transition"
              :class="canvasMode === 'vueflow' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/40'"
              @click="canvasMode = 'vueflow'"
            >
              Vue Flow
            </button>
            <button
              class="rounded-md px-2 py-0.5 text-[10px] transition"
              :class="canvasMode === 'playcanvas' ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/40'"
              @click="canvasMode = 'playcanvas'"
            >
              PlayCanvas
            </button>
          </div>
          <input
            v-model="sessionTitle"
            class="rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-white/10 focus:border-brand-500/50"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <button class="btn-ghost px-2 py-1 text-xs" @click="showStoryboard = true">分镜</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="openPublish">发布</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="addNode('shot', { title: '新分镜', prompt: '', status: 'draft' })">+ 分镜</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="addNode('image', { url: '', status: 'idle' })">+ 图像</button>
          <button class="btn-ghost px-2 py-1 text-xs" @click="addNode('video', { url: '', status: 'idle' })">+ 视频</button>
          <button class="btn-primary px-3 py-1 text-xs" :disabled="saving" @click="saveCanvas">
            {{ saving ? '...' : '保存' }}
          </button>
        </div>
      </div>

      <div class="relative flex-1">
        <VueFlow
          v-if="canvasMode === 'vueflow'"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes as any"
          :default-viewport="{ zoom: 0.8, x: 0, y: 0 }"
          :min-zoom="0.1"
          :max-zoom="2"
          fit-view-on-init
          class="canvas-flow h-full"
          @connect="onConnect"
          @node-context-menu="onNodeContextMenu"
          @pane-context-menu="onPaneContextMenu"
        >
          <Background pattern-color="#2a2a3a" :gap="20" />
          <Controls />
          <MiniMap :node-color="() => '#7c3aed'" mask-color="rgba(15, 15, 20, 0.8)" />
        </VueFlow>
        <PlayCanvasView v-else class="h-full" :nodes="playCanvasNodes" />
      </div>

      <GenerationBar :mentions="mentionOptions" @generate="handleGenerate" />
    </div>

    <!-- Right: Agent Panel (对标 NeoWOW Agent 对话区) -->
    <aside
      class="shrink-0 transition-all"
      :class="showAgent ? 'w-[320px]' : 'w-0 overflow-hidden'"
    >
      <AgentPanel
        :session-id="sessionId"
        @canvas-actions="handleAgentActions"
      />
    </aside>

    <StoryboardDialog
      v-model="showStoryboard"
      :shots="storyboardShots"
    />
    <PublishNeoTVDialog
      v-model="showPublish"
      :session-id="sessionId"
      :default-title="sessionTitle"
      @published="loadSessions"
    />
    <AIImageEditor @apply="handleImageEditorApply" />
    <CanvasContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :node-id="contextMenu.nodeId"
      :node-type="contextMenu.nodeType"
      @action="handleContextAction"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
.canvas-flow {
  background: #141414;
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
