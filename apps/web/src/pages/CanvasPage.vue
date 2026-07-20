<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent, nextTick, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  VueFlow,
  Panel,
  SelectionMode,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseEvent,
  type NodeChange,
  type EdgeChange,
  type NodeDragEvent,
  type OnConnectStartParams,
  type EdgeMouseEvent,
} from '@vue-flow/core'
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
import { resolveNodeRefs, type LocalRefBinding, type NodeRef } from '@/composables/useNodeRefs'
import { NODE_GENERATION_STATUS, isNodeGenerating } from '@/constants/dockStudio'
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
import ProviderConfigDialog from '@/components/canvas/ProviderConfigDialog.vue'
import ByokFallbackConfirmDialog from '@/components/canvas/ByokFallbackConfirmDialog.vue'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'
import { BYOK_FALLBACK_CONFIRM_MESSAGE } from '@lnkpi/shared'
import type { FallbackPendingRequest } from '@/composables/useNodeGeneration'
import { createFallbackConfirmQueue, fallbackConfirmKey } from '@/composables/fallbackConfirmQueue'
import type { StudioModality } from '@/constants/studioModels'
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
import { useCanvasViewportSettings, type CanvasViewportSettings } from '@/composables/useCanvasViewportSettings'
import { useCanvasTheme } from '@/composables/useCanvasTheme'
import { useCanvasKeyboard } from '@/composables/useCanvasKeyboard'
import { downloadMediaPackage, setupCanvasMediaHandlers, type MediaFilePayload } from '@/composables/useCanvasMedia'
import { fileToPersistedPayload, inferMediaInputKind } from '@/composables/useMediaUpload'
import { useDebouncedNodePatch } from '@/composables/useDebouncedNodePatch'
import {
  CANVAS_NODE_CANCEL_KEY,
  CANVAS_NODE_PATCH_KEY,
  CANVAS_NODE_RENAME_KEY,
  CANVAS_NODE_RETRY_KEY,
} from '@/composables/canvasNodeActions'
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

/** 受控模式：:nodes + apply-default=false，由 onNodesChange 落地变更，避免内部/外部状态互相覆盖 */
const flowNodes = computed(() => nodes.value as unknown as Node[])
const flowEdges = computed(() => edges.value as unknown as Edge[])

const { selectNode, clearEditorSelection, clearSelection, patchNodeData, selectedNodeId } = useSelectedNodeEditor(nodes)
const sessionTitle = ref('未命名画布')
const saving = ref(false)
const canvasMode = ref<'vueflow' | 'playcanvas'>('vueflow')
const showStoryboard = ref(false)
const showPublish = ref(false)
const showModelSettings = ref(false)
const contextMenu = ref<{ x: number; y: number; nodeId?: string; nodeType?: string } | null>(null)
const { settings: viewportSettings, cycleMinimap } = useCanvasViewportSettings()
const { theme: canvasTheme, toggleTheme: toggleCanvasTheme } = useCanvasTheme()

const DEFAULT_DARK_GRID_COLOR = 'rgba(255,255,255,0.08)'
const effectiveGridColor = computed(() => {
  if (canvasTheme.value === 'light' && viewportSettings.value.gridColor === DEFAULT_DARK_GRID_COLOR) {
    return 'rgba(0,0,0,0.12)'
  }
  return viewportSettings.value.gridColor
})
const multiSelectedIds = ref<string[]>([])
/** 独占选中进行中：挡住 Vue Flow 随后的 select change 把源节点再次标成 selected */
let pendingExclusiveSelectId: string | null = null
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
const { preferences, load: loadProviderBootstrap } = useProviderBootstrap()

const fallbackDialog = ref<{
  open: boolean
  message: string
  loading: boolean
}>({ open: false, message: BYOK_FALLBACK_CONFIRM_MESSAGE, loading: false })

const fallbackConfirmQueue = createFallbackConfirmQueue({
  defaultMessage: BYOK_FALLBACK_CONFIRM_MESSAGE,
  onOpen: (message) => {
    fallbackDialog.value = { open: true, message, loading: false }
  },
  onClose: () => {
    fallbackDialog.value = { ...fallbackDialog.value, open: false, loading: false }
  },
})

function requestFallbackConfirm(req: FallbackPendingRequest) {
  return fallbackConfirmQueue.request(req)
}

function onFallbackDialogConfirm() {
  fallbackDialog.value = { ...fallbackDialog.value, loading: true }
  fallbackConfirmQueue.settle('confirm')
}

function onFallbackDialogCancel() {
  fallbackConfirmQueue.settle('cancel')
}

function isModelSelectable(modality: StudioModality, model: string): boolean {
  const prefs = preferences.value
  if (!prefs) return true
  const list =
    modality === 'image'
      ? prefs.selectableImageModels
      : modality === 'video'
        ? prefs.selectableVideoModels
        : modality === 'audio'
          ? prefs.selectableAudioModels
          : prefs.selectableTextModels
  return list.includes(model)
}

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
    const createdAt = Number(data.createdAt ?? 0)
    out.push({
      id: `${node.id}-asset`,
      nodeId: node.id,
      url,
      label: String(data.title ?? data.fileName ?? data.prompt ?? node.id),
      kind,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : undefined,
      source: 'user',
    })
  }
  return out
})

const canvasInteractionEnabled = computed(() => canvasMode.value === 'vueflow' && !viewportSettings.value.viewLocked)

let onFallbackPendingFromPoll:
  | ((kind: 'studio' | 'material', id: string, nodeId: string, message?: string) => Promise<void>)
  | null = null

const fallbackPollClaimedKeys = new Set<string>()

async function invokeFallbackPendingFromPoll(
  kind: 'studio' | 'material',
  id: string,
  nodeId: string,
  message?: string,
) {
  const key = fallbackConfirmKey({ kind, id })
  // Claim synchronously so parallel poll ticks cannot both enter handlers
  // (shared Promise would otherwise double-call confirm/cancel APIs).
  if (fallbackPollClaimedKeys.has(key) || fallbackConfirmQueue.isPrompted(key)) return
  fallbackPollClaimedKeys.add(key)
  try {
    await onFallbackPendingFromPoll?.(kind, id, nodeId, message)
  } catch (err) {
    patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: err instanceof Error ? err.message : '平台回退处理失败',
    })
    void saveCanvas()
  }
}

function findLinkedMediaNodeId(shotId: string, materialId: string): string {
  if (nodes.value.some((n) => n.id === materialId)) return materialId
  for (const e of edges.value) {
    if (e.source !== shotId) continue
    const target = nodes.value.find((n) => n.id === e.target)
    if (target && (target.type === 'image' || target.type === 'video')) return target.id
  }
  return materialId
}

function parseFallbackMessage(metadata?: string | null): string | undefined {
  if (!metadata) return undefined
  try {
    const meta = JSON.parse(metadata) as { confirmMessage?: string }
    return typeof meta.confirmMessage === 'string' ? meta.confirmMessage : undefined
  } catch {
    return undefined
  }
}

const shotPolling = useShotPolling((shots) => {
  for (const shot of shots) {
    for (const material of shot.materials) {
      if (material.status === NODE_GENERATION_STATUS.fallback_pending) {
        const nodeId = findLinkedMediaNodeId(shot.id, material.id)
        patchNodeData(nodeId, { status: NODE_GENERATION_STATUS.fallback_pending })
        void invokeFallbackPendingFromPoll('material', material.id, nodeId)
        continue
      }
    }
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
    if (record.status === NODE_GENERATION_STATUS.fallback_pending) {
      patchNodeData(task.nodeId, {
        status: NODE_GENERATION_STATUS.fallback_pending,
        generationRecordId: record.id,
      })
      void invokeFallbackPendingFromPoll(
        'studio',
        record.id,
        task.nodeId,
        parseFallbackMessage(record.metadata),
      )
      continue
    }
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

const selectedRefs = computed((): NodeRef[] => {
  const node = editorNode.value
  if (!node) return []
  return resolveNodeRefs({
    targetNodeId: node.id,
    targetType: String(node.type),
    nodes: nodes.value,
    edges: edges.value.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    localRefs: (node.data?.localRefs as LocalRefBinding[]) ?? [],
    refOrder: (node.data?.refOrder as string[]) ?? [],
  })
})

const mentionOptions = computed((): Array<{ id: string; label: string; type: string }> => {
  const refOptions = selectedRefs.value
    .filter((ref) => !ref.stale)
    .map((ref) => ({
      id: ref.refId,
      label: ref.refKey,
      type: ref.mediaType,
    }))
  if (refOptions.length) return refOptions

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
  const audioModel = getProviderConfig('audio').model
  let id: string
  switch (type) {
    case 'text':
      id = addNode('text', { content: '', status: 'idle', textModel }, { position })
      break
    case 'prompt':
      id = addNode('prompt', { prompt: '', label: '提示词', status: 'idle', textModel }, { position })
      break
    case 'image':
      id = addNode('image', { url: '', status: 'idle', prompt: '', imageModel }, { position })
      break
    case 'video':
      id = addNode('video', { url: '', status: 'idle', prompt: '', videoModel }, { position })
      break
    case 'audio':
      id = addNode('audio', { url: '', status: 'idle', prompt: '', audioModel }, { position })
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
  selectOnlyNode(id)
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
  selectOnlyNode(id)
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
    data: { createdAt: Date.now(), ...data },
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
  selectOnlyNode(id)
  void saveCanvas()
  void focusNodeById(id)
}

function selectOnlyNode(id: string) {
  pendingExclusiveSelectId = id
  selectNode(id)
  multiSelectedIds.value = [id]
  // fitView / connect-end 可能异步再抛 select change，短窗口内保持独占
  window.setTimeout(() => {
    if (pendingExclusiveSelectId === id) pendingExclusiveSelectId = null
  }, 400)
}

function syncMultiSelectionFromNodes() {
  if (pendingExclusiveSelectId) {
    const id = pendingExclusiveSelectId
    nodes.value = nodes.value.map((node) => {
      const selected = node.id === id
      return node.selected === selected ? node : { ...node, selected }
    })
    multiSelectedIds.value = [id]
    selectedNodeId.value = id
    return
  }
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

/**
 * 受控模式下必须自行落地 nodesChange。
 * 注意：vue-flow 的 applyNodeChanges 对 position/dimensions 要求 isGraphNode
 *（带 computedPosition），而我们的 EditableFlowNode 是普通对象，直接 apply 会
 * 静默丢弃拖拽位移 → 鼠标是抓手但节点不动。这里对 plain node 显式应用变更。
 */
function onNodesChange(changes: NodeChange[]) {
  if (!changes.length) return

  let next = nodes.value
  let changed = false

  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      const pos = change.position
      next = next.map((node) =>
        node.id === change.id ? { ...node, position: { x: pos.x, y: pos.y } } : node,
      )
      changed = true
    } else if (change.type === 'select') {
      next = next.map((node) =>
        node.id === change.id ? { ...node, selected: change.selected } : node,
      )
      changed = true
    } else if (change.type === 'remove') {
      next = next.filter((node) => node.id !== change.id)
      changed = true
    } else if (change.type === 'add') {
      const item = change.item as EditableFlowNode
      if (!next.some((node) => node.id === item.id)) {
        next = [...next, { id: item.id, type: item.type, position: item.position, data: item.data, selected: item.selected }]
        changed = true
      }
    }
  }

  if (pendingExclusiveSelectId) {
    const id = pendingExclusiveSelectId
    next = next.map((node) => {
      const selected = node.id === id
      return node.selected === selected ? node : { ...node, selected }
    })
    changed = true
  }

  if (changed) nodes.value = next

  if (changes.some((change) => change.type === 'select') || pendingExclusiveSelectId) {
    syncMultiSelectionFromNodes()
  }
}

function onEdgesChange(changes: EdgeChange[]) {
  edges.value = applyEdgeChanges(changes, edges.value as any) as unknown as CanvasEdge[]
}

function onSelectionEnd() {
  // 框选允许多选，结束独占保护
  pendingExclusiveSelectId = null
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

function onNodeClick(event: NodeMouseEvent) {
  const mouse = event.event as MouseEvent
  const multi = mouse.shiftKey || mouse.metaKey || mouse.ctrlKey
  if (!multi) {
    // 单击独占选中，避免「拖出下游后源+目标双选 → dock 不出现 / 出现多选 +」
    selectOnlyNode(event.node.id)
  } else {
    pendingExclusiveSelectId = null
    syncMultiSelectionFromNodes()
  }
  closeContextMenu()
}

function handleGroupSelection() {
  const result = createGroupFromNodes(
    nodes.value as unknown as FlowNode[],
    multiSelectedIds.value,
  )
  if (!result) return
  nodes.value = result.nodes as unknown as EditableFlowNode[]
  selectOnlyNode(result.groupId)
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

  selectOnlyNode(id)
  void saveCanvas()
  await nextTick()
  await focusNodeById(id)
  await handleNodeGenerate()
}

function onPaneClick() {
  pendingExclusiveSelectId = null
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

function patchNodeMediaById(nodeId: string, patch: Record<string, unknown>) {
  patchNodeData(nodeId, patch)
  void saveCanvas()
}

provide(CANVAS_NODE_PATCH_KEY, patchNodeMediaById)

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

const LOCAL_REF_TARGET_TYPES = new Set(['text', 'prompt', 'image', 'video', 'audio'])

function createLocalRefId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function appendLocalRef(nodeId: string, binding: LocalRefBinding) {
  const node = findNodeById(nodeId)
  const prev = (node?.data?.localRefs as LocalRefBinding[]) ?? []
  patchNodeData(nodeId, { localRefs: [...prev, binding] })
}

function canAcceptLocalRef(nodeType: string, mediaType: LocalRefBinding['mediaType']): boolean {
  if (!LOCAL_REF_TARGET_TYPES.has(nodeType)) return false
  if (mediaType === 'text') return nodeType === 'text' || nodeType === 'prompt'
  if (mediaType === 'image') return nodeType === 'text' || nodeType === 'image' || nodeType === 'video'
  if (mediaType === 'video') return nodeType === 'video'
  if (mediaType === 'audio') return nodeType === 'audio'
  return false
}

function previewPatchForLocalRef(
  nodeType: string,
  mediaType: LocalRefBinding['mediaType'],
  url: string,
): Record<string, unknown> {
  if (mediaType === 'image' && nodeType === 'image') return { url, status: 'completed' }
  if (mediaType === 'image' && nodeType === 'video') return { referenceImageUrl: url }
  if (mediaType === 'video' && nodeType === 'video') return { url, status: 'completed' }
  if (mediaType === 'audio' && nodeType === 'audio') return { url, status: 'completed' }
  return {}
}

function applyLocalRefToSelectedNode(binding: LocalRefBinding): boolean {
  const node = editorNode.value
  if (!node) return false
  const nodeType = String(node.type ?? '')
  if (!canAcceptLocalRef(nodeType, binding.mediaType)) return false

  appendLocalRef(node.id, binding)
  const previewPatch = previewPatchForLocalRef(nodeType, binding.mediaType, binding.url ?? '')
  if (Object.keys(previewPatch).length) patchNodeData(node.id, previewPatch)
  void saveCanvas()
  return true
}

function assetPayloadFromItem(asset: CanvasAssetItem): MediaFilePayload | null {
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') return null
  return {
    url: asset.url,
    fileName: asset.label,
    mimeType: asset.kind === 'video' ? 'video/mp4' : asset.kind === 'audio' ? 'audio/mpeg' : 'image/png',
    kind: asset.kind,
  }
}

function tryApplyAssetToSelectedNode(asset: CanvasAssetItem): boolean {
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') return false
  const payload = assetPayloadFromItem(asset)
  if (!payload) return false
  return applyLocalRefToSelectedNode({
    id: createLocalRefId('asset'),
    mediaType: asset.kind,
    sourceKind: 'asset',
    label: asset.label,
    url: payload.url,
  })
}

function tryApplyUploadToSelectedNode(payload: MediaFilePayload): boolean {
  if (payload.kind === 'other') return false
  const binding: LocalRefBinding = {
    id: createLocalRefId('upload'),
    mediaType: payload.kind,
    sourceKind: 'upload',
    label: payload.fileName,
    url: payload.url,
  }
  if (payload.kind === 'text') binding.text = payload.textContent ?? ''
  return applyLocalRefToSelectedNode(binding)
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
        audioModel: getProviderConfig('audio').model,
      }, { position: resolveDropPosition(clientPos, 'audio') })
      break
  }

  if (!id) return
  selectOnlyNode(id)
  void saveCanvas()
  await focusNodeById(id)
}

async function ingestMediaFile(file: File, clientPos: { x: number; y: number }) {
  const payload = await fileToPersistedPayload(file)
  if (tryApplyUploadToSelectedNode(payload)) return
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
  selectOnlyNode(childId)
  await saveCanvas()
  await focusNodeById(childId)
}

async function handleAssetApply(asset: CanvasAssetItem) {
  if (tryApplyAssetToSelectedNode(asset)) return

  const center = canvasAreaRef.value?.getBoundingClientRect()
  const clientPos = {
    x: center ? center.left + center.width / 2 : window.innerWidth / 2,
    y: center ? center.top + center.height / 2 : window.innerHeight / 2,
  }
  const payload = assetPayloadFromItem(asset)
  if (payload) await createFileNodeAt(payload, clientPos)
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
  selectOnlyNode(id)
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

function handleRemoveRef(ref: NodeRef) {
  const node = editorNode.value
  if (!node) return
  if (ref.sourceKind === 'edge' && ref.edgeId) {
    deleteEdgeById(ref.edgeId)
    return
  }
  const localRefs = ((node.data?.localRefs as LocalRefBinding[]) ?? []).filter(
    (binding) => binding.id !== ref.refId,
  )
  patchSelectedNode({ localRefs })
}

async function handleNodeGenerate() {
  const node = editorNode.value
  if (!node) return
  // Cancel before flush so a second click isn't delayed by pending patches.
  if (isNodeBusy(node.id) || isNodeGenerating(node.data?.status)) {
    cancelGeneration(node.id)
    return
  }
  await debouncedNodePatch.flush()
  const fresh = editorNode.value
  if (!fresh) return
  if (isNodeBusy(fresh.id) || isNodeGenerating(fresh.data?.status)) {
    cancelGeneration(fresh.id)
    return
  }
  await generateForNode(fresh)
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
  // Blank canvas: open node picker directly (no intermediate menu / upload-media)
  blankNodePicker.value = { x, y }
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
  isNodeBusy,
  cancelGeneration,
  generateForNode,
  saveSceneComposer,
  expandSceneComposer,
  batchGenerateSceneComposer,
  exportVideoComposition,
  onFallbackPending,
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
  stopGenerationPolling: (nodeId) => generationPolling.removeByNodeId(nodeId),
  resolveProviderModels: () => ({
    text: getProviderConfig('text').model,
    image: getProviderConfig('image').model,
    video: getProviderConfig('video').model,
  }),
  requestFallbackConfirm,
  isModelSelectable,
})

function retryNodeGeneration(nodeId: string) {
  const node = nodes.value.find((n) => n.id === nodeId)
  if (!node) return
  const data = node.data ?? {}
  const prompt = String(data.prompt ?? '').trim()
  if (!prompt && String(node.type) !== 'sceneComposer') {
    patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '请先填写提示词',
    })
    return
  }
  patchNodeData(nodeId, { errorMessage: null })
  return generateForNode(node as EditableFlowNode)
}

provide(CANVAS_NODE_CANCEL_KEY, (id) => cancelGeneration(id))
provide(CANVAS_NODE_RETRY_KEY, (id) => { void retryNodeGeneration(id) })

const selectedNodeGenerating = computed(() => {
  const node = editorNode.value
  if (!node) return false
  return isNodeBusy(node.id) || isNodeGenerating(node.data?.status)
})

onFallbackPendingFromPoll = onFallbackPending

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

function nextNodeCounterFromNodes(list: EditableFlowNode[]) {
  let max = 0
  for (const node of list) {
    const match = String(node.id).match(/(\d+)$/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

function hydrateCanvasEdges(
  raw: Array<Pick<CanvasEdge, 'id' | 'source' | 'target'> & Partial<CanvasEdge>>,
  nodeList: EditableFlowNode[],
): CanvasEdge[] {
  const ids = new Set(nodeList.map((node) => node.id))
  const animated = viewportSettings.value.edgeAnimated
  const out: CanvasEdge[] = []
  for (const edge of raw) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    out.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      animated,
      style: { stroke: '#7c3aed', ...(edge.style ?? {}) },
    })
  }
  return out
}

async function loadSession() {
  try {
    const { data } = await api.get<{ data: { title: string; canvasData?: { nodes: Node[]; edges: Edge[] } } }>(
      `/sessions/${sessionId.value}`,
    )
    sessionTitle.value = data.data.title
    if (data.data.canvasData?.nodes?.length) {
      nodes.value = data.data.canvasData.nodes as EditableFlowNode[]
      edges.value = hydrateCanvasEdges(
        (data.data.canvasData.edges ?? []) as CanvasEdge[],
        nodes.value,
      )
      nodeCounter = nextNodeCounterFromNodes(nodes.value)
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
  void loadProviderBootstrap().catch(() => {
    // Dock falls back to catalog defaults until bootstrap succeeds
  })
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
          if (tryApplyAssetToSelectedNode(asset)) return
          const payload = assetPayloadFromItem(asset)
          if (payload) {
            void createFileNodeAt(payload, { x: event.clientX, y: event.clientY })
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
  <div class="relative h-screen w-full overflow-hidden bg-[var(--neo-bg)]" @click="closeContextMenu">
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
          :nodes="flowNodes"
          :edges="flowEdges"
          :apply-default="false"
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
          @edges-change="onEdgesChange"
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
            :color="effectiveGridColor"
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
          :refs="selectedRefs"
          :composition-tracks="editorCompositionTracks"
          :mentions="mentionOptions"
          :generating="selectedNodeGenerating"
          :scale="viewportSettings.bottomToolbarScale"
          @patch="patchSelectedNode"
          @remove-ref="handleRemoveRef"
          @generate="handleNodeGenerate"
          @save="handleSceneComposerSave"
          @expand="handleSceneComposerExpand"
          @batch-generate="handleSceneComposerBatchGenerate"
          @export="handleVideoCompositionExport"
          @upload="handleMediaInputUpload"
          @convert="handleMediaInputConvert"
          @close="onPaneClick"
        />

        <NodePanelDock
          :assets="canvasAssets"
          @add="handleDockAdd"
          @open-settings="showModelSettings = true"
          @asset-apply="handleAssetApply"
          @asset-upload="triggerMediaUpload()"
        />

        <button
          type="button"
          class="canvas-theme-toggle pointer-events-auto absolute right-3 top-3 z-[50] flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[rgba(22,22,22,0.88)] text-white/70 shadow-lg backdrop-blur-xl transition hover:text-white"
          :title="canvasTheme === 'dark' ? '切换白天模式' : '切换黑夜模式'"
          @click="toggleCanvasTheme"
        >
          <!-- 太阳 -->
          <svg v-if="canvasTheme === 'dark'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="4" />
            <path stroke-linecap="round" d="M12 3v2m0 14v2M5.64 5.64l1.41 1.41m9.9 9.9 1.41 1.41M3 12h2m14 0h2M5.64 18.36l1.41-1.41m9.9-9.9 1.41-1.41" />
          </svg>
          <!-- 月亮 -->
          <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

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

    <ProviderConfigDialog v-model="showModelSettings" />
    <ByokFallbackConfirmDialog
      v-model="fallbackDialog.open"
      :message="fallbackDialog.message"
      :loading="fallbackDialog.loading"
      @confirm="onFallbackDialogConfirm"
      @cancel="onFallbackDialogCancel"
    />
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
  background: var(--neo-bg);
  transition: background 0.25s ease;
}

:deep(.canvas-panel-bottom-left) {
  margin: 0 0 12px 8px;
  width: auto !important;
  max-width: none !important;
}

:deep(.vue-flow__selection),
:deep(.vue-flow__nodesselection-rect) {
  background: rgba(99, 102, 241, 0.08);
  border: 1.5px dashed rgba(129, 140, 248, 0.7);
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
