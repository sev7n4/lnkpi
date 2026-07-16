<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent, nextTick, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { VueFlow, Panel, SelectionMode, type Node, type Edge, type Connection, type NodeMouseEvent, type NodeChange, type NodeDragEvent, type OnConnectStartParams, type EdgeMouseEvent } from '@vue-flow/core'
import type { DockNodeType } from '@/components/canvas/NodePanelDock.vue'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import type { Session, CanvasAction } from '@lnkpi/shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { applyActionsToFlow, flowToCanvasData } from '@/composables/useCanvasActions'
import { useShotPolling } from '@/composables/useShotPolling'
import { useGenerationPolling, parseRecordText, parseRecordUrl, type GenerationPollTask } from '@/composables/useGenerationPolling'
import { useNodeGeneration } from '@/composables/useNodeGeneration'
import { createInitialSceneComposerNodeData } from '@/utils/sceneComposer'
import { resolveCompositionTracks, mergeCompositionTracks, compositionTracksToNodePatch } from '@/utils/compositionUpstream'
import { resolveUpstreamContext } from '@/composables/useUpstreamNodeContext'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import CanvasNodePrompt from '@/components/canvas/CanvasNodePrompt.vue'
import CanvasNodeImage from '@/components/canvas/CanvasNodeImage.vue'
import CanvasNodeVideo from '@/components/canvas/CanvasNodeVideo.vue'
import CanvasNodeText from '@/components/canvas/CanvasNodeText.vue'
import CanvasNodeShot from '@/components/canvas/CanvasNodeShot.vue'
import CanvasNodeGroup from '@/components/canvas/CanvasNodeGroup.vue'
import CanvasNodeAudio from '@/components/canvas/CanvasNodeAudio.vue'
import CanvasNodeDirector from '@/components/canvas/CanvasNodeDirector.vue'
import CanvasNodeMediaInput from '@/components/canvas/CanvasNodeMediaInput.vue'
import CanvasNodeVideoComposition from '@/components/canvas/CanvasNodeVideoComposition.vue'
import CanvasNodeWorldModel from '@/components/canvas/CanvasNodeWorldModel.vue'
import NodePanelDock from '@/components/canvas/NodePanelDock.vue'
import DockStudioToolbar from '@/components/canvas/DockStudioToolbar.vue'
import CanvasFloatingChrome from '@/components/canvas/CanvasFloatingChrome.vue'
import CanvasBottomLeftControls from '@/components/canvas/CanvasBottomLeftControls.vue'
import ModelProviderSettingsDialog from '@/components/canvas/ModelProviderSettingsDialog.vue'
import ClickRippleLayer from '@/components/canvas/ClickRippleLayer.vue'
import ConnectNodePicker from '@/components/canvas/ConnectNodePicker.vue'
import ConnectPickerLine from '@/components/canvas/ConnectPickerLine.vue'
import { CONNECT_OUT_TARGET_TYPES } from '@/components/canvas/canvasDockMenu'
import { computeNewNodePosition, snapToGrid } from '@/composables/useCanvasNodePlacement'
import {
  createGroupFromNodes,
  getNodeSize,
  getSelectionBounds,
  layoutNodesInGrid,
  resizeGroupToFitChildren,
  ungroupNodes,
  type FlowNode,
} from '@/composables/useCanvasGrouping'
import { useModelProviderSettings } from '@/composables/useModelProviderSettings'
import MultiSelectToolbarOverlay from '@/components/canvas/MultiSelectToolbarOverlay.vue'
import MultiSelectConnectOverlay from '@/components/canvas/MultiSelectConnectOverlay.vue'
import BatchConnectPickerLine from '@/components/canvas/BatchConnectPickerLine.vue'
import EdgeScissorsOverlay from '@/components/canvas/EdgeScissorsOverlay.vue'
import CanvasAssetPanel from '@/components/canvas/CanvasAssetPanel.vue'
import { useCanvasViewportSettings, type CanvasViewportSettings } from '@/composables/useCanvasViewportSettings'
import { useCanvasKeyboard } from '@/composables/useCanvasKeyboard'
import { downloadMediaPackage, setupCanvasMediaHandlers, type MediaFilePayload } from '@/composables/useCanvasMedia'
import { fileToPersistedPayload, inferMediaInputKind } from '@/composables/useMediaUpload'
import { useDebouncedNodePatch } from '@/composables/useDebouncedNodePatch'
import { CANVAS_NODE_RENAME_KEY } from '@/composables/canvasNodeActions'
import type { CanvasAssetItem } from '@/components/canvas/CanvasAssetPanel.vue'
import AIImageEditor from '@/components/canvas/AIImageEditor.vue'
import CanvasContextMenu from '@/components/canvas/CanvasContextMenu.vue'
import StoryboardDialog, { type StoryboardShot } from '@/components/canvas/StoryboardDialog.vue'
import PublishNeoTVDialog from '@/components/works/PublishNeoTVDialog.vue'
import AgentSideRail from '@/components/agent/AgentSideRail.vue'
import CanvasAgentFab from '@/components/agent/CanvasAgentFab.vue'
import { useSelectedNodeEditor, type EditableFlowNode, EDITABLE_NODE_TYPES } from '@/composables/useSelectedNodeEditor'

const PlayCanvasView = defineAsyncComponent(
  () => import('@/canvas/playcanvas/PlayCanvasView.vue'),
)

const route = useRoute()
const auth = useAuthStore()
const canvasEditor = useCanvasEditorStore()
const sessionId = computed(() => route.params.sessionId as string)

interface CanvasEdge {
  id: string
  source: string
  target: string
  animated?: boolean
  style?: Record<string, string | number>
  sourceHandle?: string
  targetHandle?: string
}

const nodes = ref<EditableFlowNode[]>([])
const edges = ref<CanvasEdge[]>([])

const flowNodes = computed({
  get: () => nodes.value as unknown as Node[],
  set: (value) => {
    nodes.value = value as unknown as EditableFlowNode[]
  },
})

const flowEdges = computed({
  get: () => edges.value as unknown as Edge[],
  set: (value) => {
    edges.value = value as unknown as CanvasEdge[]
  },
})

const { selectNode, clearEditorSelection, clearSelection, patchNodeData, selectedNodeId } = useSelectedNodeEditor(nodes)
const sessionTitle = ref('未命名画布')
const saving = ref(false)
const canvasMode = ref<'vueflow' | 'playcanvas'>('vueflow')
const showStoryboard = ref(false)
const showPublish = ref(false)
const showModelSettings = ref(false)
const contextMenu = ref<{ x: number; y: number; nodeId?: string; nodeType?: string } | null>(null)
const { settings: viewportSettings, cycleMinimap } = useCanvasViewportSettings()
const multiSelectedIds = ref<string[]>([])
let nodeCounter = 0

const pendingConnect = ref<{
  nodeId: string
  handleType: 'source' | 'target'
  handleId: string | null
} | null>(null)
let connectCompleted = false

const connectPicker = ref<{
  sourceNodeId: string
  sourceHandleId: string | null
  x: number
  y: number
} | null>(null)

const blankNodePicker = ref<{ x: number; y: number } | null>(null)
const selectedEdgeId = ref<string | null>(null)
const selectedEdgePos = ref({ x: 0, y: 0 })
const batchConnectPicker = ref<{ sourceIds: string[]; x: number; y: number } | null>(null)
const mediaInputRef = ref<HTMLInputElement | null>(null)
const pendingMediaPos = ref<{ x: number; y: number } | null>(null)

const { getConfig: getProviderConfig } = useModelProviderSettings()

const minimapNodeList = computed(() => {
  const out: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []
  for (const n of nodes.value) {
    out.push({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })
  }
  return out
})

function patchViewportSettings(patch: Partial<CanvasViewportSettings>) {
  Object.assign(viewportSettings.value, patch)
}

function addEdge(partial: Pick<CanvasEdge, 'id' | 'source' | 'target'> & Partial<CanvasEdge>) {
  edges.value.push({
    animated: viewportSettings.value.edgeAnimated,
    style: { stroke: '#7c3aed' },
    ...partial,
  })
}

watch(
  () => viewportSettings.value.edgeAnimated,
  (animated) => {
    edges.value = edges.value.map((edge) => ({ ...edge, animated }))
  },
)

const canvasAssets = computed((): CanvasAssetItem[] => {
  const out: CanvasAssetItem[] = []
  for (const node of nodes.value) {
    const data = node.data as Record<string, unknown>
    const url = String(data.url ?? '').trim()
    if (!url) continue
    const type = String(node.type ?? '')
    if (!['image', 'video', 'audio'].includes(type)) continue
    let kind: CanvasAssetItem['kind'] = 'other'
    if (type === 'image') kind = url.match(/\.(mp4|webm|mov)/i) ? 'video' : 'image'
    else if (type === 'video') kind = 'video'
    else if (type === 'audio') kind = 'audio'
    out.push({
      id: `${node.id}-asset`,
      nodeId: node.id,
      url,
      label: String(data.title ?? data.fileName ?? data.prompt ?? node.id),
      kind,
    })
  }
  return out
})

const canvasInteractionEnabled = computed(() => canvasMode.value === 'vueflow' && !viewportSettings.value.viewLocked)

const shotPolling = useShotPolling((shots) => {
  for (const shot of shots) {
    const material = shot.materials.find((m) => m.status === 'completed' && m.url)
    if (!material) continue
    patchNodeData(shot.id, { status: NODE_GENERATION_STATUS.completed, coverUrl: material.url })
    for (const n of nodes.value) {
      if (n.type !== 'image' && n.type !== 'video') continue
      let linked = false
      for (const e of edges.value) {
        if (e.source === shot.id && e.target === n.id) {
          linked = true
          break
        }
      }
      if (linked) {
        patchNodeData(n.id, { url: material.url, status: NODE_GENERATION_STATUS.completed })
      }
    }
  }
  void saveCanvas()
})

const generationPolling = useGenerationPolling((results) => {
  for (const { task, record } of results) {
    if (record.status === NODE_GENERATION_STATUS.completed) {
      const patch: Record<string, unknown> = {
        url: parseRecordUrl(record),
        status: NODE_GENERATION_STATUS.completed,
      }
      if (record.type === 'text') {
        patch.content = parseRecordText(record)
      }
      patchNodeData(task.nodeId, patch)
    } else if (record.status === NODE_GENERATION_STATUS.failed || record.status === NODE_GENERATION_STATUS.error) {
      patchNodeData(task.nodeId, { status: NODE_GENERATION_STATUS.error })
    }
  }
  void saveCanvas()
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

function startPollingForGeneratingVideos() {
  const tasks: GenerationPollTask[] = []
  for (const n of nodes.value) {
    if (n.type !== 'video') continue
    const data = n.data as Record<string, unknown>
    if (data.status === NODE_GENERATION_STATUS.generating && data.generationRecordId) {
      tasks.push({ recordId: String(data.generationRecordId), nodeId: n.id })
    }
  }
  if (tasks.length) generationPolling.start(tasks)
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
  for (const n of nodes.value) {
    if (n.type !== 'shot') continue
    const data = n.data as Record<string, unknown>
    out.push({
      id: n.id,
      title: String(data.title ?? '未命名分镜'),
      prompt: data.prompt as string | undefined,
      status: data.status as string | undefined,
      coverUrl: data.coverUrl as string | undefined,
      order: typeof data.order === 'number' ? data.order : out.length,
    })
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
})

const editorNode = computed((): EditableFlowNode | null => {
  if (multiSelectedIds.value.length !== 1) return null
  const id = multiSelectedIds.value[0]
  for (const node of nodes.value) {
    if (node.id !== id) continue
    const type = String(node.type ?? '')
    if (!EDITABLE_NODE_TYPES.has(type)) return null
    return node as EditableFlowNode
  }
  return null
})

const editorUpstream = computed(() => {
  const node = editorNode.value
  if (!node) {
    return { textPrompt: '', referenceImageUrl: '', referenceImageNodeId: null, textNodeIds: [] }
  }
  return resolveUpstreamContext(node.id, nodes.value, edges.value)
})

const editorCompositionTracks = computed(() => {
  const node = editorNode.value
  if (!node || node.type !== 'videoComposition') return []
  const live = resolveCompositionTracks(node.id, nodes.value, edges.value)
  const data = node.data ?? {}
  return mergeCompositionTracks(
    live,
    data.tracks as import('@/utils/compositionUpstream').CompositionTrackRecord[] | undefined,
    data.trackOrder as string[] | undefined,
  )
})

const multiSelectCanUngroup = computed(() => {
  if (multiSelectedIds.value.length !== 1) return false
  const node = findNodeById(multiSelectedIds.value[0])
  return node?.type === 'group'
})

const multiSelectCanGenerateVideo = computed(() => {
  if (multiSelectedIds.value.length < 2) return false
  let hasText = false
  let hasImage = false
  for (const id of multiSelectedIds.value) {
    const node = findNodeById(id)
    if (!node) continue
    const type = String(node.type ?? '')
    if (type === 'text' || type === 'prompt') hasText = true
    if (type === 'image') {
      const url = String((node.data as Record<string, unknown>).url ?? '').trim()
      if (url) hasImage = true
    }
    if (type === 'mediaInput') {
      const url = String((node.data as Record<string, unknown>).url ?? '').trim()
      if (url) hasImage = true
    }
  }
  return hasText && hasImage
})

const nodeTypes = {
  prompt: CanvasNodePrompt,
  image: CanvasNodeImage,
  video: CanvasNodeVideo,
  text: CanvasNodeText,
  shot: CanvasNodeShot,
  group: CanvasNodeGroup,
  audio: CanvasNodeAudio,
  sceneComposer: CanvasNodeDirector,
  mediaInput: CanvasNodeMediaInput,
  videoComposition: CanvasNodeVideoComposition,
  worldModel: CanvasNodeWorldModel,
}

function onConnect(connection: Connection) {
  connectCompleted = true
  pendingConnect.value = null
  connectPicker.value = null
  addEdge({
    id: `e-${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
  })
}

function onConnectStart(params: OnConnectStartParams & { event?: MouseEvent | TouchEvent }) {
  connectCompleted = false
  connectPicker.value = null
  if (!params.nodeId || !params.handleType) return
  pendingConnect.value = {
    nodeId: params.nodeId,
    handleType: params.handleType,
    handleId: params.handleId,
  }
}

function getConnectEndClientPoint(event: MouseEvent | TouchEvent) {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    }
  }
  const mouse = event as MouseEvent
  return { x: mouse.clientX, y: mouse.clientY }
}

function onConnectEnd(event?: MouseEvent | TouchEvent) {
  if (connectCompleted) {
    pendingConnect.value = null
    return
  }

  const pending = pendingConnect.value
  pendingConnect.value = null
  if (!pending || !event || pending.handleType !== 'source') return

  const { x: clientX, y: clientY } = getConnectEndClientPoint(event)
  const droppedOnNode = document.elementFromPoint(clientX, clientY)?.closest('.vue-flow__node')
  if (droppedOnNode) return

  window.setTimeout(() => {
    connectPicker.value = {
      sourceNodeId: pending.nodeId,
      sourceHandleId: pending.handleId,
      x: clientX,
      y: clientY,
    }
  }, 50)
}

function closeConnectPicker() {
  connectPicker.value = null
}

function screenToFlowPoint(x: number, y: number) {
  const flow = vueFlowRef.value as {
    screenToFlowCoordinate?: (pos: { x: number; y: number }) => { x: number; y: number }
  } | null
  if (!flow?.screenToFlowCoordinate) return { x: 280, y: 180 }
  return flow.screenToFlowCoordinate({ x, y })
}

function createNodeAt(type: DockNodeType, position: { x: number; y: number }) {
  const textModel = getProviderConfig('text').model
  const imageModel = getProviderConfig('image').model
  const videoModel = getProviderConfig('video').model
  let id: string
  switch (type) {
    case 'text':
      id = addNode('text', { content: '', status: 'idle', textModel }, { position })
      break
    case 'image':
      id = addNode('image', { url: '', status: 'idle', prompt: '', imageModel }, { position })
      break
    case 'video':
      id = addNode('video', { url: '', status: 'idle', prompt: '', videoModel }, { position })
      break
    case 'audio':
      id = addNode('audio', { url: '', status: 'idle', prompt: '' }, { position })
      break
    case 'sceneComposer':
      id = addNode('sceneComposer', createInitialSceneComposerNodeData(), { position })
      break
    case 'group':
      id = addNode('group', { title: `分组 ${countNodesByType('group') + 1}`, childIds: [] }, { position })
      break
    case 'mediaInput':
      id = addNode('mediaInput', { url: '', status: 'idle', title: '媒体输入', fileName: '' }, { position })
      break
    case 'videoComposition':
      id = addNode(
        'videoComposition',
        { title: '视频合成', clipCount: 0, tracks: [], trackOrder: [], status: 'draft' },
        { position },
      )
      break
    case 'worldModel':
      id = addNode('worldModel', { title: '3D 世界', prompt: '', status: 'beta' }, { position })
      break
    case 'shot':
      id = addNode('shot', { title: '新分镜', prompt: '', status: 'draft', order: storyboardShots.value.length }, { position })
      break
    default:
      return null
  }
  return id
}

function connectSourceToNode(sourceNodeId: string, targetNodeId: string) {
  const edgeId = `e-${sourceNodeId}-${targetNodeId}`
  if (edges.value.some((edge) => edge.id === edgeId)) return
  addEdge({ id: edgeId, source: sourceNodeId, target: targetNodeId })
}

function handleBlankPickerSelect(type: DockNodeType) {
  const picker = blankNodePicker.value
  if (!picker) return
  blankNodePicker.value = null

  const flowPoint = screenToFlowPoint(picker.x, picker.y)
  const { w, h } = getNodeSize({ type } as FlowNode)
  const grid = viewportSettings.value.gridGap
  const snap = viewportSettings.value.snapToGrid
  const position = {
    x: snap ? snapToGrid(flowPoint.x - w / 2, grid) : flowPoint.x - w / 2,
    y: snap ? snapToGrid(flowPoint.y - h / 2, grid) : flowPoint.y - h / 2,
  }

  const id = createNodeAt(type, position)
  if (!id) return
  selectNode(id)
  multiSelectedIds.value = [id]
  void saveCanvas()
  void focusNodeById(id)
}

function closeBlankNodePicker() {
  blankNodePicker.value = null
}

function handleConnectPickerSelect(type: DockNodeType) {
  const picker = connectPicker.value
  if (!picker) return
  connectPicker.value = null

  const flowPoint = screenToFlowPoint(picker.x, picker.y)
  const { w, h } = getNodeSize({ type } as FlowNode)
  const grid = viewportSettings.value.gridGap
  const snap = viewportSettings.value.snapToGrid
  const position = {
    x: snap ? snapToGrid(flowPoint.x - w / 2, grid) : flowPoint.x - w / 2,
    y: snap ? snapToGrid(flowPoint.y - h / 2, grid) : flowPoint.y - h / 2,
  }

  const id = createNodeAt(type, position)
  if (!id) return

  connectSourceToNode(picker.sourceNodeId, id)
  selectNode(id)
  multiSelectedIds.value = [id]
  void saveCanvas()
  void focusNodeById(id)
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
  nodes.value = result.nodes as unknown as EditableFlowNode[]
  edges.value = result.edges as unknown as CanvasEdge[]
  startPollingForGeneratingShots()
  void saveCanvas()
}

function resolveNewNodePosition(type: string) {
  const flow = vueFlowRef.value as {
    screenToFlowCoordinate?: (pos: { x: number; y: number }) => { x: number; y: number }
  } | null
  const canvasEl = document.querySelector('.canvas-flow') as HTMLElement | null
  if (!flow?.screenToFlowCoordinate || !canvasEl) {
    return {
      x: 280 + nodeCounter * 20,
      y: 180 + nodeCounter * 20,
    }
  }
  return computeNewNodePosition(
    type,
    nodes.value as unknown as FlowNode[],
    { screenToFlowCoordinate: flow.screenToFlowCoordinate.bind(flow) },
    canvasEl,
    {
      grid: viewportSettings.value.gridGap,
      dockStudioReserve: 80,
      snapToGrid: viewportSettings.value.snapToGrid,
    },
  )
}

async function focusNodeById(id: string) {
  await nextTick()
  await vueFlowRef.value?.fitView({ nodes: [id], padding: 0.45, duration: 320, maxZoom: 1.05 })
}

function handleDockAdd(type: DockNodeType) {
  const position = resolveNewNodePosition(type)
  const id = createNodeAt(type, position)
  if (!id) return
  selectNode(id)
  multiSelectedIds.value = [id]
  void saveCanvas()
  void focusNodeById(id)
}

function syncMultiSelectionFromNodes() {
  const ids: string[] = []
  for (const node of nodes.value) {
    if (node.selected) ids.push(node.id)
  }
  multiSelectedIds.value = ids
  if (ids.length === 1) {
    selectedNodeId.value = ids[0]
  } else {
    clearEditorSelection()
  }
}

function onNodesChange(changes: NodeChange[]) {
  for (const change of changes) {
    if (change.type === 'select') {
      syncMultiSelectionFromNodes()
      return
    }
  }
}

function onSelectionEnd() {
  syncMultiSelectionFromNodes()
}

function onNodeDragStop(event: NodeDragEvent) {
  const node = event.node
  if (node.parentNode) {
    nodes.value = resizeGroupToFitChildren(nodes.value as unknown as FlowNode[], node.parentNode) as EditableFlowNode[]
    void saveCanvas()
    return
  }
  if (node.type === 'group') {
    void saveCanvas()
  }
}

function onNodeClick(_event: NodeMouseEvent) {
  syncMultiSelectionFromNodes()
  closeContextMenu()
}

function handleGroupSelection() {
  const result = createGroupFromNodes(
    nodes.value as unknown as FlowNode[],
    multiSelectedIds.value,
  )
  if (!result) return
  nodes.value = result.nodes as unknown as EditableFlowNode[]
  selectNode(result.groupId)
  multiSelectedIds.value = [result.groupId]
  void nextTick().then(() => {
    vueFlowRef.value?.updateNodeInternals?.()
  })
  void saveCanvas()
}

function handleUngroupById(groupId: string) {
  const next = ungroupNodes(nodes.value as unknown as FlowNode[], groupId)
  if (!next) return
  nodes.value = next as EditableFlowNode[]
  multiSelectedIds.value = []
  clearSelection()
  void saveCanvas()
}

function handleUngroupSelection() {
  if (multiSelectedIds.value.length !== 1) return
  handleUngroupById(multiSelectedIds.value[0])
}

function handleDeleteSelection() {
  const ids = [...multiSelectedIds.value]
  const toRemove = new Set<string>()
  for (const id of ids) {
    toRemove.add(id)
    const node = findNodeById(id)
    if (node?.type === 'group') {
      for (const child of nodes.value) {
        if (child.parentNode === id) toRemove.add(child.id)
      }
    }
  }
  const nextNodes: EditableFlowNode[] = []
  for (const node of nodes.value) {
    if (!toRemove.has(node.id)) nextNodes.push(node)
  }
  nodes.value = nextNodes
  const nextEdges: CanvasEdge[] = []
  for (const edge of edges.value) {
    if (!toRemove.has(edge.source) && !toRemove.has(edge.target)) nextEdges.push(edge)
  }
  edges.value = nextEdges
  multiSelectedIds.value = []
  clearSelection()
  void saveCanvas()
}

function handleLayoutSelection() {
  nodes.value = layoutNodesInGrid(
    nodes.value as unknown as FlowNode[],
    multiSelectedIds.value,
  ) as EditableFlowNode[]
  void saveCanvas()
}

function findSelectedNodes() {
  const out: EditableFlowNode[] = []
  for (const id of multiSelectedIds.value) {
    const node = findNodeById(id)
    if (node) out.push(node)
  }
  return out
}

function pickTextSourceNode(selected: EditableFlowNode[]) {
  for (const node of selected) {
    const type = String(node.type ?? '')
    if (type === 'text' || type === 'prompt') return node
  }
  return null
}

function pickImageSourceNode(selected: EditableFlowNode[]) {
  for (const node of selected) {
    const type = String(node.type ?? '')
    const data = node.data as Record<string, unknown>
    const url = String(data.url ?? '').trim()
    if ((type === 'image' || type === 'mediaInput') && url) return node
  }
  return null
}

function connectNodes(sourceId: string, targetId: string) {
  const edgeId = `e-${sourceId}-${targetId}`
  if (edges.value.some((edge) => edge.id === edgeId)) return
  addEdge({ id: edgeId, source: sourceId, target: targetId })
}

async function handleGenerateVideoFromSelection() {
  const selected = findSelectedNodes()
  const textNode = pickTextSourceNode(selected)
  const imageNode = pickImageSourceNode(selected)
  if (!textNode || !imageNode) return

  const textData = textNode.data as Record<string, unknown>
  const prompt = String(textData.content ?? textData.prompt ?? '').trim()
  if (!prompt) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }

  const imageUrl = String((imageNode.data as Record<string, unknown>).url ?? '').trim()
  const videoModel = getProviderConfig('video').model
  const bounds = getSelectionBounds(nodes.value as unknown as FlowNode[], multiSelectedIds.value)
  const { w } = getNodeSize({ type: 'video' } as FlowNode)
  const position = bounds
    ? { x: bounds.centerX - w / 2, y: bounds.bottomY + 36 }
    : resolveNewNodePosition('video')

  const id = addNode('video', {
    url: '',
    status: 'idle',
    prompt,
    videoModel,
    referenceImageUrl: imageUrl,
  }, { position })

  connectNodes(textNode.id, id)
  connectNodes(imageNode.id, id)

  selectNode(id)
  multiSelectedIds.value = [id]
  void saveCanvas()
  await nextTick()
  await focusNodeById(id)
  await handleNodeGenerate()
}

function onPaneClick() {
  multiSelectedIds.value = []
  selectedEdgeId.value = null
  clearSelection()
  closeContextMenu()
  closeBlankNodePicker()
  closeBatchConnectPicker()
}

function onPaneDoubleClick(event: MouseEvent) {
  if (viewportSettings.value.viewLocked) return
  const target = event.target as HTMLElement
  if (target.closest('.vue-flow__node')) return
  blankNodePicker.value = { x: event.clientX, y: event.clientY }
}

function onEdgeClick({ edge, event }: EdgeMouseEvent) {
  selectedEdgeId.value = edge.id
  const coords = getEventCoords(event)
  selectedEdgePos.value = { x: coords.x, y: coords.y }
  closeContextMenu()
}

function deleteEdgeById(edgeId: string) {
  edges.value = edges.value.filter((edge) => edge.id !== edgeId)
  if (selectedEdgeId.value === edgeId) selectedEdgeId.value = null
  void saveCanvas()
}

function renameNodeById(nodeId: string, title: string) {
  const node = findNodeById(nodeId)
  if (!node) return
  const type = String(node.type ?? '')
  if (type === 'text' || type === 'prompt') {
    patchNodeData(nodeId, { title, label: title })
  } else {
    patchNodeData(nodeId, { title })
  }
  void saveCanvas()
}

provide(CANVAS_NODE_RENAME_KEY, renameNodeById)

function resolveDropPosition(clientPos: { x: number; y: number }, nodeType: string) {
  const flowPoint = screenToFlowPoint(clientPos.x, clientPos.y)
  const { w, h } = getNodeSize({ type: nodeType } as FlowNode)
  const grid = viewportSettings.value.gridGap
  const snap = viewportSettings.value.snapToGrid
  return {
    x: snap ? snapToGrid(flowPoint.x - w / 2, grid) : flowPoint.x - w / 2,
    y: snap ? snapToGrid(flowPoint.y - h / 2, grid) : flowPoint.y - h / 2,
  }
}

async function createFileNodeAt(payload: MediaFilePayload, clientPos: { x: number; y: number }) {
  if (payload.kind === 'other') return

  const title = payload.fileName.replace(/\.[^.]+$/, '') || payload.fileName
  const meta = {
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    title,
  }
  let id: string | null = null

  switch (payload.kind) {
    case 'text':
      id = addNode('text', {
        content: payload.textContent ?? '',
        ...meta,
        status: 'completed',
        textModel: getProviderConfig('text').model,
      }, { position: resolveDropPosition(clientPos, 'text') })
      break
    case 'image':
      id = addNode('image', {
        url: payload.url,
        status: 'completed',
        ...meta,
        prompt: '',
        imageModel: getProviderConfig('image').model,
      }, { position: resolveDropPosition(clientPos, 'image') })
      break
    case 'video':
      id = addNode('video', {
        url: payload.url,
        status: 'completed',
        ...meta,
        prompt: '',
        videoModel: getProviderConfig('video').model,
      }, { position: resolveDropPosition(clientPos, 'video') })
      break
    case 'audio':
      id = addNode('audio', {
        url: payload.url,
        status: 'completed',
        ...meta,
        prompt: '',
      }, { position: resolveDropPosition(clientPos, 'audio') })
      break
  }

  if (!id) return
  selectNode(id)
  multiSelectedIds.value = [id]
  void saveCanvas()
  await focusNodeById(id)
}

async function ingestMediaFile(file: File, clientPos: { x: number; y: number }) {
  const payload = await fileToPersistedPayload(file)
  await createFileNodeAt(payload, clientPos)
}

function triggerMediaUpload(clientX?: number, clientY?: number) {
  pendingMediaPos.value = {
    x: clientX ?? window.innerWidth / 2,
    y: clientY ?? window.innerHeight / 2,
  }
  mediaInputRef.value?.click()
}

async function onMediaFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const pos = pendingMediaPos.value ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  pendingMediaPos.value = null
  await ingestMediaFile(file, pos)
}

async function handleMediaInputUpload(file: File) {
  const node = editorNode.value
  if (!node || node.type !== 'mediaInput') return
  patchNodeData(node.id, { status: 'uploading' })
  try {
    const payload = await fileToPersistedPayload(file)
    if (payload.kind === 'other' || payload.kind === 'text') return
    const mediaKind = inferMediaInputKind(payload.mimeType, payload.url)
    patchNodeData(node.id, {
      url: payload.url,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      mediaKind,
      title: payload.fileName.replace(/\.[^.]+$/, '') || payload.fileName,
      status: 'completed',
    })
    await saveCanvas()
  } catch {
    patchNodeData(node.id, { status: 'error' })
  }
}

async function handleMediaInputConvert(targetType: 'image' | 'video' | 'audio') {
  const node = editorNode.value
  if (!node || node.type !== 'mediaInput') return
  const data = node.data as Record<string, unknown>
  const url = String(data.url ?? '').trim()
  if (!url) return

  const title = String(data.title ?? data.fileName ?? '素材')
  const childId = addNode(targetType, {
    url,
    status: 'completed',
    title,
    fileName: data.fileName,
    mimeType: data.mimeType,
    prompt: '',
    ...(targetType === 'image' ? { imageModel: getProviderConfig('image').model } : {}),
    ...(targetType === 'video' ? { videoModel: getProviderConfig('video').model } : {}),
  }, {
    position: { x: node.position.x + 300, y: node.position.y },
  })
  addEdge({
    id: `e-${node.id}-${childId}`,
    source: node.id,
    target: childId,
    style: { stroke: '#6366f1' },
  })
  selectNode(childId)
  multiSelectedIds.value = [childId]
  await saveCanvas()
  await focusNodeById(childId)
}

async function handleAssetApply(asset: CanvasAssetItem) {
  const center = canvasAreaRef.value?.getBoundingClientRect()
  const clientPos = {
    x: center ? center.left + center.width / 2 : window.innerWidth / 2,
    y: center ? center.top + center.height / 2 : window.innerHeight / 2,
  }
  if (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio') {
    await createFileNodeAt(
      {
        url: asset.url,
        fileName: asset.label,
        mimeType: asset.kind === 'video' ? 'video/mp4' : asset.kind === 'audio' ? 'audio/mpeg' : 'image/png',
        kind: asset.kind,
      },
      clientPos,
    )
  }
}

async function handlePackageDownload() {
  await downloadMediaPackage(
    nodes.value.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })),
    multiSelectedIds.value,
  )
}

function connectSelectionToTarget(targetId: string, sourceIds = multiSelectedIds.value) {
  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue
    connectNodes(sourceId, targetId)
  }
  void saveCanvas()
}

function handleMultiConnectTarget(targetId: string) {
  connectSelectionToTarget(targetId)
}

function handleMultiConnectBlank(clientX: number, clientY: number) {
  batchConnectPicker.value = {
    sourceIds: [...multiSelectedIds.value],
    x: clientX,
    y: clientY,
  }
}

function closeBatchConnectPicker() {
  batchConnectPicker.value = null
}

function handleBatchConnectPickerSelect(type: DockNodeType) {
  const picker = batchConnectPicker.value
  if (!picker) return
  batchConnectPicker.value = null

  const flowPoint = screenToFlowPoint(picker.x, picker.y)
  const { w, h } = getNodeSize({ type } as FlowNode)
  const grid = viewportSettings.value.gridGap
  const snap = viewportSettings.value.snapToGrid
  const position = {
    x: snap ? snapToGrid(flowPoint.x - w / 2, grid) : flowPoint.x - w / 2,
    y: snap ? snapToGrid(flowPoint.y - h / 2, grid) : flowPoint.y - h / 2,
  }

  const id = createNodeAt(type, position)
  if (!id) return

  connectSelectionToTarget(id, picker.sourceIds)
  selectNode(id)
  multiSelectedIds.value = [id]
  void focusNodeById(id)
}

function handleKeyboardDelete() {
  if (selectedEdgeId.value) {
    deleteEdgeById(selectedEdgeId.value)
    return
  }
  if (multiSelectedIds.value.length) {
    handleDeleteSelection()
  }
}

function panViewport(dx: number, dy: number) {
  const flow = vueFlowRef.value as {
    getViewport?: () => { x: number; y: number; zoom: number }
    setViewport?: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => void
  } | null
  if (!flow?.getViewport || !flow?.setViewport) return
  const vp = flow.getViewport()
  flow.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, { duration: 0 })
}

function zoomViewport(delta: number) {
  const flow = vueFlowRef.value as {
    getViewport?: () => { x: number; y: number; zoom: number }
    zoomTo?: (zoom: number, options?: { duration?: number }) => void
  } | null
  if (!flow?.getViewport || !flow?.zoomTo) return
  const next = Math.min(2, Math.max(0.1, flow.getViewport().zoom * delta))
  flow.zoomTo(next, { duration: 120 })
}

useCanvasKeyboard({
  enabled: canvasInteractionEnabled,
  onZoomIn: () => zoomViewport(1.12),
  onZoomOut: () => zoomViewport(1 / 1.12),
  onPan: panViewport,
  onDelete: handleKeyboardDelete,
})

function patchSelectedNode(patch: Record<string, unknown>) {
  if (!editorNode.value) return
  debouncedNodePatch.patchNode(editorNode.value.id, patch)
}

async function handleNodeGenerate() {
  await debouncedNodePatch.flush()
  const node = editorNode.value
  if (!node) return
  await generateForNode(node)
}

async function handleSceneComposerSave() {
  await debouncedNodePatch.flush()
  const node = editorNode.value
  if (!node || node.type !== 'sceneComposer') return
  await saveSceneComposer(node)
}

async function handleSceneComposerExpand() {
  await debouncedNodePatch.flush()
  const node = editorNode.value
  if (!node || node.type !== 'sceneComposer') return
  await expandSceneComposer(node)
}

async function handleSceneComposerBatchGenerate() {
  await debouncedNodePatch.flush()
  const node = editorNode.value
  if (!node || node.type !== 'sceneComposer') return
  await batchGenerateSceneComposer(node)
}

async function handleVideoCompositionExport() {
  await debouncedNodePatch.flush()
  const node = editorNode.value
  if (!node || node.type !== 'videoComposition') return
  await exportVideoComposition(node, editorCompositionTracks.value)
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
    const toRemove = new Set<string>([menu.nodeId])
    const node = findNodeById(menu.nodeId)
    if (node?.type === 'group') {
      for (const child of nodes.value) {
        if (child.parentNode === menu.nodeId) toRemove.add(child.id)
      }
    }
    nodes.value = nodes.value.filter((entry) => !toRemove.has(entry.id))
    edges.value = edges.value.filter((edge) => !toRemove.has(edge.source) && !toRemove.has(edge.target))
    void saveCanvas()
    return
  }

  if (action === 'ungroup' && menu.nodeId) {
    handleUngroupById(menu.nodeId)
    return
  }

  if (action === 'add-node') {
    blankNodePicker.value = { x: menu.x, y: menu.y }
    return
  }

  if (action === 'upload-media') {
    triggerMediaUpload(menu.x, menu.y)
  }
}

function countNodesByType(type: string) {
  let count = 0
  for (const node of nodes.value) {
    if (node.type === type) count += 1
  }
  return count
}

function handleStoryboardUpdated(shots: StoryboardShot[]) {
  for (const shot of shots) {
    const node = findNodeById(shot.id)
    if (!node) continue
    node.data = {
      ...(node.data as Record<string, unknown>),
      title: shot.title,
      prompt: shot.prompt,
      order: shot.order,
    }
  }
  void saveCanvas()
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

const {
  generating: nodeGenerating,
  generateForNode,
  saveSceneComposer,
  expandSceneComposer,
  batchGenerateSceneComposer,
  exportVideoComposition,
} = useNodeGeneration({
  nodes,
  edges,
  sessionId,
  patchNodeData,
  addNode,
  addEdge,
  saveCanvas,
  requireLogin: () => {
    if (!auth.isLoggedIn) {
      auth.openLogin()
      return false
    }
    return true
  },
  startShotPolling: (ids) => shotPolling.start(ids),
  startGenerationPolling: (tasks) => generationPolling.start(tasks),
  resolveProviderModels: () => ({
    image: getProviderConfig('image').model,
    video: getProviderConfig('video').model,
  }),
})

const debouncedNodePatch = useDebouncedNodePatch(
  (id, patch) => patchNodeData(id, patch),
  saveCanvas,
)

watch(
  editorCompositionTracks,
  (tracks) => {
    const node = editorNode.value
    if (!node || node.type !== 'videoComposition') return
    const patch = compositionTracksToNodePatch(tracks)
    const data = node.data ?? {}
    const sameCount = data.clipCount === patch.clipCount
    const sameTracks = JSON.stringify(data.tracks ?? []) === JSON.stringify(patch.tracks)
    const sameOrder = JSON.stringify(data.trackOrder ?? []) === JSON.stringify(patch.trackOrder)
    if (sameCount && sameTracks && sameOrder) return
    debouncedNodePatch.patchNode(node.id, patch)
  },
  { deep: true },
)

async function loadSession() {
  try {
    const { data } = await api.get<{ data: { title: string; canvasData?: { nodes: Node[]; edges: Edge[] } } }>(
      `/sessions/${sessionId.value}`,
    )
    sessionTitle.value = data.data.title
    if (data.data.canvasData?.nodes?.length) {
      nodes.value = data.data.canvasData.nodes as EditableFlowNode[]
      edges.value = (data.data.canvasData.edges ?? []) as CanvasEdge[]
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
  startPollingForGeneratingShots()
  startPollingForGeneratingVideos()
}

async function loadSessions() {
  if (!auth.isLoggedIn) return
  try {
    await api.get<{ data: Session[] }>('/sessions')
  } catch {
    // ignore
  }
}

const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null)
const canvasAreaRef = ref<HTMLElement | null>(null)
const agentRailRef = ref<InstanceType<typeof AgentSideRail> | null>(null)

onMounted(() => {
  loadSession()
  loadSessions()

  const mediaHandlers = setupCanvasMediaHandlers(canvasAreaRef, (file, clientPos) => {
    void ingestMediaFile(file, clientPos)
  })

  const area = canvasAreaRef.value
  if (area) {
    area.addEventListener('dragover', mediaHandlers.onDragOver)
    area.addEventListener('drop', (event) => {
      const assetRaw = event.dataTransfer?.getData('application/lnkpi-asset')
      if (assetRaw) {
        event.preventDefault()
        try {
          const asset = JSON.parse(assetRaw) as CanvasAssetItem
          if (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio') {
            void createFileNodeAt(
              {
                url: asset.url,
                fileName: asset.label,
                mimeType: asset.kind === 'video' ? 'video/mp4' : asset.kind === 'audio' ? 'audio/mpeg' : 'image/png',
                kind: asset.kind,
              },
              { x: event.clientX, y: event.clientY },
            )
          }
        } catch {
          // ignore
        }
        return
      }
      void mediaHandlers.onDrop(event)
    })
  }
  window.addEventListener('paste', mediaHandlers.onPaste)
})
</script>

<template>
  <div class="relative h-screen w-full overflow-hidden bg-[#141414]" @click="closeContextMenu">
    <div class="flex h-full min-w-0 overflow-hidden">
      <div ref="canvasAreaRef" class="relative min-h-0 min-w-0 flex-1">
        <ClickRippleLayer :container="canvasAreaRef" />
        <CanvasFloatingChrome
          :title="sessionTitle"
          :saving="saving"
          @update:title="sessionTitle = $event"
          @save="saveCanvas"
          @storyboard="showStoryboard = true"
          @publish="openPublish"
        />

        <VueFlow
          v-if="canvasMode === 'vueflow'"
          ref="vueFlowRef"
          v-model:nodes="flowNodes"
          v-model:edges="flowEdges"
          :node-types="nodeTypes as any"
          :default-viewport="{ zoom: 0.8, x: 0, y: 0 }"
          :min-zoom="0.1"
          :max-zoom="2"
          :nodes-selectable="!viewportSettings.viewLocked"
          :elements-selectable="!viewportSettings.viewLocked"
          :select-nodes-on-drag="false"
          :selection-key-code="viewportSettings.viewLocked ? null : true"
          :pan-on-drag="viewportSettings.viewLocked ? false : [1, 2]"
          :pan-on-scroll="!viewportSettings.viewLocked"
          :pan-activation-key-code="viewportSettings.viewLocked ? null : 'Space'"
          :zoom-on-scroll="!viewportSettings.viewLocked"
          :nodes-draggable="!viewportSettings.viewLocked"
          :nodes-connectable="!viewportSettings.viewLocked"
          :multi-selection-key-code="['Shift', 'Meta', 'Control'] as any"
          :selection-mode="SelectionMode.Partial"
          :snap-to-grid="viewportSettings.snapToGrid"
          :snap-grid="[viewportSettings.gridGap, viewportSettings.gridGap]"
          :connection-radius="48"
          :delete-key-code="null"
          fit-view-on-init
          class="canvas-flow h-full"
          @connect="onConnect"
          @connect-start="onConnectStart"
          @connect-end="onConnectEnd"
          @nodes-change="onNodesChange"
          @selection-end="onSelectionEnd"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
          @pane-click="onPaneClick"
          @dblclick="onPaneDoubleClick"
          @node-context-menu="onNodeContextMenu"
          @pane-context-menu="onPaneContextMenu"
          @edge-click="onEdgeClick"
        >
          <Background
            v-if="viewportSettings.gridVisible"
            :variant="viewportSettings.gridVariant"
            :gap="viewportSettings.gridGap"
            :size="viewportSettings.gridDotSize"
            :color="viewportSettings.gridColor"
          />

          <MultiSelectToolbarOverlay
            :selected-ids="multiSelectedIds"
            :can-generate-video="multiSelectCanGenerateVideo"
            :can-ungroup="multiSelectCanUngroup"
            @group="handleGroupSelection"
            @ungroup="handleUngroupSelection"
            @delete="handleDeleteSelection"
            @layout="handleLayoutSelection"
            @generate-video="handleGenerateVideoFromSelection"
            @download="handlePackageDownload"
          />

          <MultiSelectConnectOverlay
            :selected-ids="multiSelectedIds"
            @connect-target="handleMultiConnectTarget"
            @connect-blank="handleMultiConnectBlank"
          />

          <BatchConnectPickerLine
            v-if="batchConnectPicker"
            :selected-ids="batchConnectPicker.sourceIds"
            :target-x="batchConnectPicker.x"
            :target-y="batchConnectPicker.y"
          />

          <EdgeScissorsOverlay
            :edge-id="selectedEdgeId"
            :x="selectedEdgePos.x"
            :y="selectedEdgePos.y"
            @delete="deleteEdgeById"
          />

          <ConnectPickerLine
            v-if="connectPicker"
            :source-node-id="connectPicker.sourceNodeId"
            :source-handle-id="connectPicker.sourceHandleId"
            :target-x="connectPicker.x"
            :target-y="connectPicker.y"
          />

          <Panel position="bottom-left" class="canvas-panel-bottom-left">
            <CanvasBottomLeftControls
              :settings="viewportSettings"
              :nodes="minimapNodeList"
              @update:settings="patchViewportSettings"
              @cycle-minimap="cycleMinimap"
            />
          </Panel>
        </VueFlow>
        <PlayCanvasView v-else class="h-full" :nodes="playCanvasNodes" />

        <DockStudioToolbar
          :node="editorNode"
          :upstream="editorUpstream"
          :composition-tracks="editorCompositionTracks"
          :mentions="mentionOptions"
          :generating="nodeGenerating"
          :scale="viewportSettings.bottomToolbarScale"
          @patch="patchSelectedNode"
          @generate="handleNodeGenerate"
          @save="handleSceneComposerSave"
          @expand="handleSceneComposerExpand"
          @batch-generate="handleSceneComposerBatchGenerate"
          @export="handleVideoCompositionExport"
          @upload="handleMediaInputUpload"
          @convert="handleMediaInputConvert"
          @close="onPaneClick"
        />

        <NodePanelDock @add="handleDockAdd" @open-settings="showModelSettings = true" />

        <CanvasAssetPanel
          :assets="canvasAssets"
          @apply="handleAssetApply"
          @upload="triggerMediaUpload()"
        />

        <input
          ref="mediaInputRef"
          type="file"
          accept="image/*,video/*,audio/*,text/*,.txt,.md,.json,.csv"
          class="hidden"
          @change="onMediaFileSelected"
        >

        <ConnectNodePicker
          v-if="batchConnectPicker"
          :x="batchConnectPicker.x"
          :y="batchConnectPicker.y"
          :allowed-types="CONNECT_OUT_TARGET_TYPES"
          @select="handleBatchConnectPickerSelect"
          @close="closeBatchConnectPicker"
        />

        <ConnectNodePicker
          v-if="connectPicker"
          :x="connectPicker.x"
          :y="connectPicker.y"
          :allowed-types="CONNECT_OUT_TARGET_TYPES"
          @select="handleConnectPickerSelect"
          @close="closeConnectPicker"
        />

        <ConnectNodePicker
          v-if="blankNodePicker"
          :x="blankNodePicker.x"
          :y="blankNodePicker.y"
          @select="handleBlankPickerSelect"
          @close="closeBlankNodePicker"
        />

        <CanvasAgentFab @open="agentRailRef?.openPanel()" />
      </div>

      <AgentSideRail
        ref="agentRailRef"
        :session-id="sessionId"
        @canvas-actions="handleAgentActions"
      />
    </div>

    <ModelProviderSettingsDialog v-model="showModelSettings" />
    <StoryboardDialog
      v-model="showStoryboard"
      :shots="storyboardShots"
      :session-id="sessionId"
      @updated="handleStoryboardUpdated"
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

:deep(.canvas-panel-bottom-left) {
  margin: 0 0 12px 8px;
  width: auto !important;
  max-width: none !important;
}

:deep(.vue-flow__selection) {
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(129, 140, 248, 0.55);
  border-radius: 4px;
}

:deep(.vue-flow__node) {
  overflow: visible !important;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: #a5b4fc !important;
  stroke-width: 2.5px;
}

:deep(.vue-flow__handle.neo-flow-handle) {
  cursor: crosshair;
}
</style>
