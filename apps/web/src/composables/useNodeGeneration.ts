import { ref, type Ref } from 'vue'
import type { VideoSettings } from '@lnkpi/shared'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { NODE_GENERATION_STATUS, isNodeGenerating } from '@/constants/dockStudio'
import { DEFAULT_AUDIO_VOICE } from '@/constants/dockAudio'
import {
  mergeReferenceImageUrl,
  resolveUpstreamContext,
  type CanvasEdgeLike,
} from '@/composables/useUpstreamNodeContext'
import { resolveNodeRefs, type LocalRefBinding } from '@/composables/useNodeRefs'
import {
  parseRecordPromptContent,
  parseRecordText,
  parseRecordUrl,
  parseRecordUrls,
  type GenerationPollTask,
} from '@/composables/useGenerationPolling'
import { parseRefMentions } from '@/composables/useRefMentions'
import { canvasApi } from '@/services/canvas-api'
import { studioApi, type GenerationRecord, type StudioRefPayload } from '@/services/studio-api'
import {
  resolveGenerationModel,
  type StudioModality,
} from '@/constants/studioModels'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import { applyTrackOrder } from '@/utils/compositionUpstream'
import {
  buildBatchGenerateItems,
  expandSceneComposerGraph,
  readSceneComposerFromNode,
  resolveCanvasImageParams,
  resolveCanvasVideoParams,
  sceneComposerToNodePatch,
} from '@/utils/sceneComposer'
import {
  extractRefundedPointsFromError,
  formatCancelledMessage,
} from '@/utils/generationPointsMessage'
import {
  buildPollingFailurePatch,
  parseShortGenerationError,
} from '@/utils/generationDiagnostic'
import { useAuthStore } from '@/stores/auth'

export type FallbackConfirmDecision = 'confirm' | 'cancel'

export interface FallbackPendingRequest {
  kind: 'studio' | 'material'
  id: string
  nodeId: string
  message?: string
}

export interface NodeGenerationDeps {
  nodes: Ref<EditableFlowNode[]>
  edges: Ref<CanvasEdgeLike[]>
  sessionId: Ref<string>
  patchNodeData: (id: string, patch: Record<string, unknown>) => void
  addNode: (type: string, data: Record<string, unknown>, opts?: { id?: string; position?: { x: number; y: number } }) => string
  addEdge: (edge: CanvasEdgeLike & { id: string; style?: Record<string, string | number> }) => void
  saveCanvas: () => Promise<void>
  requireLogin: () => boolean
  startShotPolling: (shotIds: string[]) => void
  startGenerationPolling: (tasks: GenerationPollTask[]) => void
  stopGenerationPolling?: (nodeId: string) => void
  stopShotPolling?: (nodeId: string) => void
  resolveProviderModels: () => { image: string; video: string; text: string }
  requestFallbackConfirm?: (req: FallbackPendingRequest) => Promise<FallbackConfirmDecision>
  isModelSelectable?: (modality: StudioModality, model: string) => boolean
  onInsufficientPoints?: () => void
}

/** Node still accepts poll / resolve writes (not cancelled to draft). */
function acceptsGenerationWrite(status: unknown): boolean {
  return isNodeGenerating(status) || status === 'pending'
}

function localPrompt(data: Record<string, unknown>): string {
  return String(data.prompt ?? data.content ?? '').trim()
}

function startedAtPatch(): Record<string, unknown> {
  return { generationStartedAt: new Date().toISOString() }
}

function normalizeEdges(edges: CanvasEdgeLike[]) {
  return edges.map((edge) => ({
    id: edge.id ?? `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
  }))
}

function resolveStudioRefs(
  node: EditableFlowNode,
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
): StudioRefPayload[] {
  const data = node.data ?? {}
  return resolveNodeRefs({
    targetNodeId: node.id,
    targetType: String(node.type),
    nodes,
    edges: normalizeEdges(edges),
    localRefs: (data.localRefs as LocalRefBinding[]) ?? [],
    refOrder: (data.refOrder as string[]) ?? [],
  })
    .filter((r) => !r.stale)
    .map((r) => ({
      refKey: r.refKey,
      mediaType: r.mediaType,
      label: r.label,
      text: r.payload.text,
      url: r.payload.url,
    }))
}

function firstImageRefUrl(refs: StudioRefPayload[]): string {
  for (const ref of refs) {
    if (ref.mediaType === 'image' && ref.url?.trim()) return ref.url.trim()
  }
  return ''
}

function hasBlobReference(refs: StudioRefPayload[], data: Record<string, unknown>): boolean {
  const direct = String(data.referenceImageUrl ?? '').trim()
  if (direct.startsWith('blob:')) return true
  for (const ref of refs) {
    if (ref.url?.trim().startsWith('blob:')) return true
  }
  return false
}

function findNodeById(nodes: EditableFlowNode[], id: string) {
  for (const node of nodes) {
    if (node.id === id) return node
  }
  return null
}

function findIncomingEdge(edges: CanvasEdgeLike[], targetId: string) {
  for (const edge of edges) {
    if (edge.target === targetId) return edge
  }
  return null
}

function findShotMediaChild(
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
  shotId: string,
  childType: string,
): EditableFlowNode | null {
  for (const edge of edges) {
    if (edge.source !== shotId) continue
    const target = findNodeById(nodes, edge.target)
    if (target?.type === childType) return target
  }
  return null
}

function shotHasChildType(nodes: EditableFlowNode[], edges: CanvasEdgeLike[], shotId: string, childType: string) {
  return findShotMediaChild(nodes, edges, shotId, childType) !== null
}

function parseConfirmMessage(metadata?: string | null): string | undefined {
  if (!metadata) return undefined
  try {
    const meta = JSON.parse(metadata) as { confirmMessage?: string }
    return typeof meta.confirmMessage === 'string' ? meta.confirmMessage : undefined
  } catch {
    return undefined
  }
}

function modalityForNodeType(nodeType: string): StudioModality | null {
  if (nodeType === 'image') return 'image'
  if (nodeType === 'video') return 'video'
  if (nodeType === 'audio') return 'audio'
  if (nodeType === 'text' || nodeType === 'prompt') return 'text'
  return null
}

function modelFieldForModality(modality: StudioModality): string {
  if (modality === 'image') return 'imageModel'
  if (modality === 'video') return 'videoModel'
  if (modality === 'audio') return 'audioModel'
  return 'textModel'
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; name?: string; message?: string }
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError'
}

export function useNodeGeneration(deps: NodeGenerationDeps) {
  const auth = useAuthStore()
  const busyNodeIds = ref(new Set<string>())
  const abortByNodeId = new Map<string, AbortController>()

  function refreshPointsAfterGeneration() {
    void auth.refreshPoints()
  }

  function patchGenerationError(nodeId: string, err: unknown, signal?: AbortSignal) {
    const refundedPoints = extractRefundedPointsFromError(err)
    if (signal?.aborted) {
      if (refundedPoints) {
        deps.patchNodeData(nodeId, { errorMessage: formatCancelledMessage(refundedPoints) })
      }
      return
    }
    if (isAbortError(err)) return
    const short = parseShortGenerationError(err)
    if (short.userMessage.includes('积分不足')) deps.onInsufficientPoints?.()
    if (!nodeAcceptsWrite(nodeId)) return
    const patch: Record<string, unknown> = {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: short.userMessage,
    }
    if (short.errorCode) patch.errorCode = short.errorCode
    if (short.taskKind === 'generation' && short.taskId) patch.generationRecordId = short.taskId
    if (short.taskKind === 'material' && short.taskId) patch.materialId = short.taskId
    deps.patchNodeData(nodeId, patch)
  }

  function isNodeBusy(nodeId: string): boolean {
    return busyNodeIds.value.has(nodeId)
  }

  function markBusy(nodeId: string) {
    const next = new Set(busyNodeIds.value)
    next.add(nodeId)
    busyNodeIds.value = next
  }

  function markIdle(nodeId: string) {
    if (!busyNodeIds.value.has(nodeId)) return
    const next = new Set(busyNodeIds.value)
    next.delete(nodeId)
    busyNodeIds.value = next
  }

  /** True when any node is mid-request (legacy aggregate; prefer isNodeBusy). */
  const generating = ref(false)
  function syncGeneratingFlag() {
    generating.value = busyNodeIds.value.size > 0
  }

  function nodeAcceptsWrite(nodeId: string): boolean {
    const current = findNodeById(deps.nodes.value, nodeId)
    return acceptsGenerationWrite(current?.data?.status)
  }

function resolveMaterialId(node: EditableFlowNode | undefined): string | undefined {
  if (!node) return undefined
  const data = node.data ?? {}
  if (typeof data.materialId === 'string' && data.materialId.trim()) {
    return data.materialId.trim()
  }
  return undefined
}

function collectCancelTargets(nodeId: string): {
  recordIds: string[]
  materialIds: string[]
} {
  const recordIds = new Set<string>()
  const materialIds = new Set<string>()
  const node = findNodeById(deps.nodes.value, nodeId)
  if (!node) return { recordIds: [], materialIds: [] }

  const recordId = node.data?.generationRecordId
  if (typeof recordId === 'string' && recordId.trim()) recordIds.add(recordId.trim())

  const materialId = resolveMaterialId(node)
  if (materialId) materialIds.add(materialId)

  if (node.type === 'shot') {
    for (const edge of deps.edges.value) {
      if (edge.source !== nodeId) continue
      const child = findNodeById(deps.nodes.value, edge.target)
      if (!child || (child.type !== 'image' && child.type !== 'video')) continue
      const childMaterialId = resolveMaterialId(child)
      if (childMaterialId) materialIds.add(childMaterialId)
    }
  }

  if (node.type === 'image' || node.type === 'video') {
    const linkedShotEdge = findIncomingEdge(deps.edges.value, nodeId)
    const shotId = linkedShotEdge?.source
    const shotNode = shotId ? findNodeById(deps.nodes.value, shotId) : null
    if (shotNode?.type === 'shot' && shotId) {
      const shotMaterialId = resolveMaterialId(shotNode)
      if (shotMaterialId) materialIds.add(shotMaterialId)
    }
  }

  return { recordIds: [...recordIds], materialIds: [...materialIds] }
}

async function cancelRemoteGeneration(nodeId: string) {
  const { recordIds, materialIds } = collectCancelTargets(nodeId)
  if (!recordIds.length && !materialIds.length) return
  await Promise.all([
    ...recordIds.map((id) => studioApi.cancelGeneration(id).catch(() => undefined)),
    ...materialIds.map((id) => canvasApi.cancelMaterial(id).catch(() => undefined)),
  ])
  await refreshPointsAfterGeneration()
}

  function cancelGeneration(nodeId: string) {
    const ac = abortByNodeId.get(nodeId)
    if (ac) {
      ac.abort()
      abortByNodeId.delete(nodeId)
    }
    deps.stopGenerationPolling?.(nodeId)
    deps.stopShotPolling?.(nodeId)
    const node = findNodeById(deps.nodes.value, nodeId)
    if (node && (node.type === 'image' || node.type === 'video')) {
      const linkedShotEdge = findIncomingEdge(deps.edges.value, nodeId)
      const shotId = linkedShotEdge?.source
      const shotNode = shotId ? findNodeById(deps.nodes.value, shotId) : null
      if (shotNode?.type === 'shot' && shotId) {
        deps.stopShotPolling?.(shotId)
        deps.patchNodeData(shotId, {
          status: NODE_GENERATION_STATUS.draft,
          errorMessage: formatCancelledMessage(),
        })
        markIdle(shotId)
      }
    }
    if (node?.type === 'shot') {
      for (const edge of deps.edges.value) {
        if (edge.source !== nodeId) continue
        const child = findNodeById(deps.nodes.value, edge.target)
        if (!child || (child.type !== 'image' && child.type !== 'video')) continue
        if (!isNodeGenerating(child.data?.status)) continue
        deps.stopGenerationPolling?.(child.id)
        const childAc = abortByNodeId.get(child.id)
        if (childAc) {
          childAc.abort()
          abortByNodeId.delete(child.id)
        }
        markIdle(child.id)
        deps.patchNodeData(child.id, {
          status: NODE_GENERATION_STATUS.draft,
          errorMessage: formatCancelledMessage(),
        })
      }
    }
    markIdle(nodeId)
    syncGeneratingFlag()
    deps.patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.draft,
      errorMessage: formatCancelledMessage(),
    })
    refreshPointsAfterGeneration()
    void cancelRemoteGeneration(nodeId)
  }

  function beginNodeWork(nodeId: string): AbortSignal {
    const existing = abortByNodeId.get(nodeId)
    if (existing) existing.abort()
    const ac = new AbortController()
    abortByNodeId.set(nodeId, ac)
    markBusy(nodeId)
    syncGeneratingFlag()
    return ac.signal
  }

  function endNodeWork(nodeId: string, signal?: AbortSignal) {
    const ac = abortByNodeId.get(nodeId)
    if (ac && (!signal || ac.signal === signal)) {
      abortByNodeId.delete(nodeId)
    }
    markIdle(nodeId)
    syncGeneratingFlag()
  }

  async function handleStudioFallback(nodeId: string, record: GenerationRecord): Promise<boolean> {
    if (record.status !== NODE_GENERATION_STATUS.fallback_pending) return false
    const decision = deps.requestFallbackConfirm
      ? await deps.requestFallbackConfirm({
          kind: 'studio',
          id: record.id,
          nodeId,
          message: parseConfirmMessage(record.metadata),
        })
      : 'cancel'

    if (decision === 'confirm') {
      const { data: res } = await studioApi.confirmPlatformFallback(record.id)
      return applyStudioRecord(nodeId, res.data)
    }

    await studioApi.cancelPlatformFallback(record.id)
    if (!nodeAcceptsWrite(nodeId)) return false
    deps.patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '已取消平台回退',
      generationRecordId: record.id,
    })
    return true
  }

  function applyStudioRecord(nodeId: string, record: GenerationRecord): boolean {
    const current = findNodeById(deps.nodes.value, nodeId)
    if (!acceptsGenerationWrite(current?.data?.status)) return false
    if (record.status === NODE_GENERATION_STATUS.fallback_pending) {
      return false
    }
    if (record.status === NODE_GENERATION_STATUS.completed) {
      const urls = parseRecordUrls(record)
      const patch: Record<string, unknown> = {
        status: NODE_GENERATION_STATUS.completed,
        errorMessage: null,
        generationRecordId: record.id,
      }
      if (record.type === 'text' || record.type === 'prompt') {
        if (record.type === 'prompt') {
          const parsed = parseRecordPromptContent(record)
          patch.content = parsed.content
          patch.promptMode = parsed.mode
        } else {
          const content = parseRecordText(record)
          patch.content = content
          // Keep dock prompt intact — result lives on the node card via `content`.
        }
      } else {
        patch.url = urls[0] ?? parseRecordUrl(record)
        if (urls.length) patch.images = urls
      }
      deps.patchNodeData(nodeId, patch)
      return true
    }
    if (
      record.status === NODE_GENERATION_STATUS.generating ||
      record.status === 'pending'
    ) {
      deps.patchNodeData(nodeId, {
        status: NODE_GENERATION_STATUS.generating,
        generationRecordId: record.id,
      })
      deps.startGenerationPolling([{ recordId: record.id, nodeId }])
      return true
    }
    deps.patchNodeData(
      nodeId,
      buildPollingFailurePatch({
        metadata: record.metadata,
        generationRecordId: record.id,
      }),
    )
    return true
  }

  async function resolveStudioRecord(nodeId: string, record: GenerationRecord) {
    const current = findNodeById(deps.nodes.value, nodeId)
    if (!acceptsGenerationWrite(current?.data?.status)) return
    if (record.status === NODE_GENERATION_STATUS.fallback_pending) {
      const handled = await handleStudioFallback(nodeId, record)
      if (!handled) {
        if (!nodeAcceptsWrite(nodeId)) return
        deps.patchNodeData(nodeId, {
          status: NODE_GENERATION_STATUS.error,
          errorMessage: '平台回退仍待确认',
          generationRecordId: record.id,
        })
      }
      await deps.saveCanvas()
      return
    }
    applyStudioRecord(nodeId, record)
    await deps.saveCanvas()
  }

  function assertModelSelectable(node: EditableFlowNode, modality: StudioModality, model: string): boolean {
    if (!deps.isModelSelectable || deps.isModelSelectable(modality, model)) return true
    deps.patchNodeData(node.id, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '当前模型已停用，请重新选择模型后再生成',
    })
    return false
  }

  async function generateForNode(node: EditableFlowNode) {
    if (isNodeBusy(node.id) || isNodeGenerating(node.data?.status)) {
      cancelGeneration(node.id)
      return
    }

    const data = node.data ?? {}
    const nodeType = String(node.type)
    const upstream = resolveUpstreamContext(node.id, deps.nodes.value, deps.edges.value)
    const local = localPrompt(data)
    const refs = resolveStudioRefs(node, deps.nodes.value, deps.edges.value)
    const mentionedKeys = parseRefMentions(local)
    if (!deps.requireLogin()) return
    if (nodeType === 'prompt') {
      if (!local) return
    } else if (nodeType !== 'sceneComposer' && !local && !refs.length) {
      return
    }

    if (hasBlobReference(refs, data)) {
      deps.patchNodeData(node.id, {
        status: NODE_GENERATION_STATUS.error,
        errorMessage: '参考图尚未上传，请先上传后再生成',
      })
      return
    }

    const modality = modalityForNodeType(nodeType)
    if (modality) {
      const field = modelFieldForModality(modality)
      const model = resolveGenerationModel(modality, data[field] as string | undefined)
      if (!assertModelSelectable(node, modality, model)) return
    }

    const signal = beginNodeWork(node.id)

    try {
      if (nodeType === 'prompt') {
        deps.patchNodeData(node.id, { ...startedAtPatch(), status: NODE_GENERATION_STATUS.generating })
        const { data: res } = await studioApi.generatePrompt(
          local,
          resolveGenerationModel('text', data.textModel as string | undefined),
          signal,
        )
        if (signal.aborted) return
        await resolveStudioRecord(node.id, res.data)
        return
      }

      if (nodeType === 'text') {
        deps.patchNodeData(node.id, {
          ...startedAtPatch(),
          status: NODE_GENERATION_STATUS.generating,
          prompt: local,
        })
        const thinking = data.textThinking === true
        const thinkingEffort = data.textThinkingEffort === 'max' ? 'max' : 'high'
        const { data: res } = await studioApi.generateText(
          local,
          resolveGenerationModel('text', data.textModel as string | undefined),
          refs,
          mentionedKeys,
          signal,
          thinking,
          thinking ? thinkingEffort : undefined,
        )
        if (signal.aborted) return
        await resolveStudioRecord(node.id, res.data)
        return
      }

      if (nodeType === 'audio') {
        deps.patchNodeData(node.id, {
          ...startedAtPatch(),
          status: NODE_GENERATION_STATUS.generating,
          prompt: local,
        })
        const { data: res } = await studioApi.generateAudio(local, {
          model: resolveGenerationModel('audio', data.audioModel as string | undefined),
          voice: String(data.audioVoice ?? DEFAULT_AUDIO_VOICE),
          emotion: String(data.audioEmotion ?? 'neutral'),
          language: String(data.audioLanguage ?? 'zh'),
          speed: typeof data.audioSpeed === 'number' ? data.audioSpeed : 1,
          volume: typeof data.audioVolume === 'number' ? data.audioVolume : 1,
          pitch: typeof data.audioPitch === 'number' ? data.audioPitch : 0,
        }, refs, mentionedKeys, signal)
        if (signal.aborted) return
        await resolveStudioRecord(node.id, res.data)
        return
      }

      if (nodeType === 'sceneComposer') {
        await saveSceneComposer(node)
        return
      }

      if (nodeType === 'image' || nodeType === 'video') {
        await generateImageOrVideo(node, local, data, upstream, refs, mentionedKeys, signal)
        return
      }

      if (nodeType === 'shot') {
        await generateShot(node, local, data, signal)
      }
    } catch (err) {
      if (signal.aborted) {
        patchGenerationError(node.id, err, signal)
        return
      }
      if (isAbortError(err)) return
      console.error('[NodeGeneration]', nodeType, err)
      patchGenerationError(node.id, err, signal)
    } finally {
      endNodeWork(node.id, signal)
      refreshPointsAfterGeneration()
    }
  }

  async function generateImageOrVideo(
    node: EditableFlowNode,
    prompt: string,
    data: Record<string, unknown>,
    upstream: ReturnType<typeof resolveUpstreamContext>,
    refs: StudioRefPayload[],
    mentionedKeys: string[],
    signal?: AbortSignal,
  ) {
    const nodeType = String(node.type)
    const linkedShotEdge = findIncomingEdge(deps.edges.value, node.id)
    const shotId = linkedShotEdge?.source
    const shotNode = shotId ? findNodeById(deps.nodes.value, shotId) : null

    if (shotNode?.type === 'shot' && shotId) {
      deps.patchNodeData(node.id, {
        ...startedAtPatch(),
        status: NODE_GENERATION_STATUS.generating,
        prompt,
      })
      deps.patchNodeData(shotId, {
        ...startedAtPatch(),
        status: NODE_GENERATION_STATUS.generating,
        prompt,
      })
      if (nodeType === 'video') {
        const params = resolveCanvasVideoParams(data)
        const { data: matRes } = await canvasApi.generateVideo(shotId, prompt, { ...params, refs, mentionedKeys })
        const materialId = (matRes.data as { id: string }).id
        deps.patchNodeData(node.id, { materialId })
        deps.patchNodeData(shotId, { materialId })
      } else {
        const params = resolveCanvasImageParams(data)
        const { data: matRes } = await canvasApi.generateImage(shotId, prompt, { ...params, refs, mentionedKeys })
        const materialId = (matRes.data as { id: string }).id
        deps.patchNodeData(node.id, { materialId })
        deps.patchNodeData(shotId, { materialId })
      }
      if (signal?.aborted || !nodeAcceptsWrite(node.id) || !nodeAcceptsWrite(shotId)) return
      deps.startShotPolling([shotId])
      await deps.saveCanvas()
      return
    }

    deps.patchNodeData(node.id, {
      ...startedAtPatch(),
      status: NODE_GENERATION_STATUS.generating,
      prompt,
    })

    const refImage = firstImageRefUrl(refs) || mergeReferenceImageUrl(data, upstream)

    if (nodeType === 'image') {
      const aspectRatio = String(data.imageAspect ?? '16:9')
      const resolution = String(data.imageResolution ?? '1K')
      const count = Number(data.imageCount ?? 1)
      const { data: res } = await studioApi.generateImage(
        prompt,
        resolveGenerationModel('image', data.imageModel as string | undefined),
        aspectRatio,
        refs,
        mentionedKeys,
        resolution,
        count,
        signal,
      )
      if (signal?.aborted) return
      deps.patchNodeData(node.id, {
        referenceImageUrl: refImage || undefined,
        imageResolution: resolution,
        imageCount: count,
        generationRecordId: res.data.id,
      })
      await resolveStudioRecord(node.id, res.data)
      return
    }

    const settings = data.videoSettings as VideoSettings | undefined
    const { data: res } = await studioApi.generateVideo(
      prompt,
      resolveGenerationModel('video', data.videoModel as string | undefined),
      settings?.duration,
      settings?.aspectRatio,
      refs,
      mentionedKeys,
      settings?.resolution,
      settings?.crop,
      signal,
    )
    if (signal?.aborted) return
    deps.patchNodeData(node.id, {
      referenceImageUrl: refImage || undefined,
      generationRecordId: res.data.id,
    })
    await resolveStudioRecord(node.id, res.data)
  }

  async function handleMaterialFallback(nodeId: string, materialId: string, message?: string) {
    const decision = deps.requestFallbackConfirm
      ? await deps.requestFallbackConfirm({
          kind: 'material',
          id: materialId,
          nodeId,
          message,
        })
      : 'cancel'

    if (decision === 'confirm') {
      await canvasApi.confirmMaterialPlatformFallback(materialId)
      if (!nodeAcceptsWrite(nodeId)) return
      deps.patchNodeData(nodeId, { status: NODE_GENERATION_STATUS.generating })
      const shotEdge = findIncomingEdge(deps.edges.value, nodeId)
      if (shotEdge?.source) deps.startShotPolling([shotEdge.source])
      return
    }

    await canvasApi.cancelMaterialPlatformFallback(materialId)
    if (!nodeAcceptsWrite(nodeId)) return
    deps.patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '已取消平台回退',
    })
  }

  /** Exposed for CanvasPage shot/generation polling when status becomes fallback_pending */
  async function onFallbackPending(
    kind: 'studio' | 'material',
    id: string,
    nodeId: string,
    message?: string,
  ) {
    try {
      if (kind === 'studio') {
        await handleStudioFallback(nodeId, {
          id,
          type: 'video',
          prompt: '',
          status: NODE_GENERATION_STATUS.fallback_pending,
          metadata: message ? JSON.stringify({ confirmMessage: message }) : null,
          createdAt: new Date().toISOString(),
        })
      } else {
        await handleMaterialFallback(nodeId, id, message)
      }
      await deps.saveCanvas()
    } catch (err) {
      const current = findNodeById(deps.nodes.value, nodeId)
      if (current && !acceptsGenerationWrite(current.data?.status)) return
      deps.patchNodeData(nodeId, {
        status: NODE_GENERATION_STATUS.error,
        errorMessage: err instanceof Error ? err.message : '平台回退处理失败',
      })
      await deps.saveCanvas()
    }
  }

  async function generateShot(
    node: EditableFlowNode,
    prompt: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const refs = resolveStudioRefs(node, deps.nodes.value, deps.edges.value)
    const mentionedKeys = parseRefMentions(prompt)
    deps.patchNodeData(node.id, {
      ...startedAtPatch(),
      status: NODE_GENERATION_STATUS.generating,
      prompt,
    })
    const title = String(data.title ?? (prompt.slice(0, 24) || '新分镜'))
    try {
      await canvasApi.editShot(node.id, { title, prompt })
    } catch {
      if (signal?.aborted || !nodeAcceptsWrite(node.id)) return
      const shotRes = await canvasApi.createShot(deps.sessionId.value, { title, prompt })
      const shot = shotRes.data.data as { id: string }
      if (signal?.aborted || !nodeAcceptsWrite(node.id)) return
      if (shot.id !== node.id) {
        deps.patchNodeData(node.id, {
          ...startedAtPatch(),
          title,
          prompt,
          status: NODE_GENERATION_STATUS.generating,
        })
      }
    }

    if (signal?.aborted || !nodeAcceptsWrite(node.id)) return

    const hasVideoChild = shotHasChildType(deps.nodes.value, deps.edges.value, node.id, 'video')
    const hasImageChild = shotHasChildType(deps.nodes.value, deps.edges.value, node.id, 'image')
    const mode = String(data.shotGenerateMode ?? 'auto')

    const shouldGenerateVideo = mode === 'video' || (mode === 'auto' && hasVideoChild)
    const shouldGenerateImage = mode === 'image' || (mode === 'auto' && hasImageChild && !shouldGenerateVideo)

    if (shouldGenerateVideo) {
      const childNode = findShotMediaChild(deps.nodes.value, deps.edges.value, node.id, 'video')
      const params = resolveCanvasVideoParams(childNode?.data ?? {})
      const { data: matRes } = await canvasApi.generateVideo(node.id, prompt, { ...params, refs, mentionedKeys })
      const materialId = (matRes.data as { id: string }).id
      deps.patchNodeData(node.id, { materialId })
      if (childNode) deps.patchNodeData(childNode.id, { materialId })
    } else if (shouldGenerateImage) {
      const childNode = findShotMediaChild(deps.nodes.value, deps.edges.value, node.id, 'image')
      const params = resolveCanvasImageParams(childNode?.data ?? {})
      const { data: matRes } = await canvasApi.generateImage(node.id, prompt, { ...params, refs, mentionedKeys })
      const materialId = (matRes.data as { id: string }).id
      deps.patchNodeData(node.id, { materialId })
      if (childNode) deps.patchNodeData(childNode.id, { materialId })
    } else {
      const params = resolveCanvasImageParams({})
      const matRes = await canvasApi.generateImage(node.id, prompt, { ...params, refs, mentionedKeys })
      if (signal?.aborted || !nodeAcceptsWrite(node.id)) return
      const material = matRes.data.data as { id: string }
      deps.patchNodeData(node.id, { materialId: material.id })
      deps.addNode('image', {
        url: '',
        ...startedAtPatch(),
        status: NODE_GENERATION_STATUS.generating,
        prompt,
        materialId: material.id,
      }, {
        id: material.id,
        position: { x: node.position.x + 280, y: node.position.y },
      })
      deps.addEdge({
        id: `e-${node.id}-${material.id}`,
        source: node.id,
        target: material.id,
        style: { stroke: '#6366f1' },
      })
    }
    if (signal?.aborted || !nodeAcceptsWrite(node.id)) return
    deps.startShotPolling([node.id])
    await deps.saveCanvas()
  }

  async function saveSceneComposer(node: EditableFlowNode) {
    if (!deps.requireLogin()) return
    const payload = readSceneComposerFromNode(node)
    const patch = sceneComposerToNodePatch(payload)
    deps.patchNodeData(node.id, { ...patch, status: NODE_GENERATION_STATUS.draft })
    await canvasApi.saveSceneComposer({
      sessionId: deps.sessionId.value,
      composerNodeId: node.id,
      title: payload.title,
      prompt: payload.prompt,
      scenes: payload.scenes,
    })
    await deps.saveCanvas()
  }

  async function expandSceneComposer(node: EditableFlowNode) {
    if (!deps.requireLogin()) return
    if (isNodeBusy(node.id)) {
      cancelGeneration(node.id)
      return
    }
    const signal = beginNodeWork(node.id)
    try {
      const current = readSceneComposerFromNode(node)
      const models = deps.resolveProviderModels()
      const expanded = expandSceneComposerGraph(node, current, {
        nodes: deps.nodes.value,
        addNode: deps.addNode,
        addEdge: deps.addEdge,
        imageModel: models.image,
        videoModel: models.video,
      })
      const patch = sceneComposerToNodePatch(expanded)
      deps.patchNodeData(node.id, { ...patch, status: NODE_GENERATION_STATUS.draft })
      await canvasApi.saveSceneComposer({
        sessionId: deps.sessionId.value,
        composerNodeId: node.id,
        title: expanded.title,
        prompt: expanded.prompt,
        scenes: expanded.scenes,
      })
      await deps.saveCanvas()
    } catch (err) {
      if (signal.aborted) {
        patchGenerationError(node.id, err, signal)
        return
      }
      if (isAbortError(err)) return
      patchGenerationError(node.id, err, signal)
    } finally {
      endNodeWork(node.id, signal)
      refreshPointsAfterGeneration()
    }
  }

  async function batchGenerateSceneComposer(node: EditableFlowNode) {
    if (!deps.requireLogin()) return
    if (isNodeBusy(node.id) || isNodeGenerating(node.data?.status)) {
      cancelGeneration(node.id)
      return
    }
    const signal = beginNodeWork(node.id)
    try {
      const payload = readSceneComposerFromNode(node)
      const items = buildBatchGenerateItems(payload, {
        nodes: deps.nodes.value,
        edges: deps.edges.value,
        composerNodeId: node.id,
      })
      if (!items.length) return

      for (const item of items) {
        if (hasBlobReference(item.refs ?? [], {})) {
          deps.patchNodeData(node.id, {
            status: NODE_GENERATION_STATUS.error,
            errorMessage: '参考图尚未上传，请先上传后再生成',
          })
          return
        }
      }

      deps.patchNodeData(node.id, { ...startedAtPatch(), status: NODE_GENERATION_STATUS.generating })
      for (const item of items) {
        deps.patchNodeData(item.shotNodeId, {
          ...startedAtPatch(),
          status: NODE_GENERATION_STATUS.generating,
          prompt: item.prompt,
        })
      }

      await canvasApi.batchGenerateSceneComposer({
        sessionId: deps.sessionId.value,
        composerNodeId: node.id,
        items,
      })

      if (
        signal.aborted
        || !nodeAcceptsWrite(node.id)
        || items.some((item) => !nodeAcceptsWrite(item.shotNodeId))
      ) {
        return
      }
      deps.startShotPolling(items.map((item) => item.shotNodeId))
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
      await deps.saveCanvas()
    } catch (err) {
      if (signal.aborted) {
        patchGenerationError(node.id, err, signal)
        return
      }
      if (isAbortError(err)) return
      patchGenerationError(node.id, err, signal)
    } finally {
      endNodeWork(node.id, signal)
      refreshPointsAfterGeneration()
    }
  }

  async function exportVideoComposition(node: EditableFlowNode, tracks: CompositionTrack[]) {
    if (!deps.requireLogin()) return
    if (isNodeBusy(node.id) || isNodeGenerating(node.data?.status)) {
      cancelGeneration(node.id)
      return
    }
    const ordered = applyTrackOrder(tracks, node.data?.trackOrder as string[] | undefined)
    const exportTracks = ordered.filter((track) => track.url.trim())
    if (!exportTracks.length) return

    const signal = beginNodeWork(node.id)
    try {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
      const { data: res } = await canvasApi.exportVideoComposition({
        sessionId: deps.sessionId.value,
        compositionNodeId: node.id,
        title: String(node.data?.title ?? '视频合成'),
        tracks: exportTracks.map((track) => ({
          nodeId: track.nodeId,
          type: track.type,
          title: track.title,
          url: track.url,
          durationSec: track.durationSec,
          startSec: track.startSec,
        })),
      })
      if (signal.aborted) return
      const result = res.data as { url: string; durationSec: number }
      deps.patchNodeData(node.id, {
        url: result.url,
        exportDurationSec: result.durationSec,
        status: NODE_GENERATION_STATUS.completed,
        exportedAt: new Date().toISOString(),
      })
      await deps.saveCanvas()
    } catch (err) {
      if (signal.aborted) {
        patchGenerationError(node.id, err, signal)
        return
      }
      if (isAbortError(err)) return
      patchGenerationError(node.id, err, signal)
    } finally {
      endNodeWork(node.id, signal)
      refreshPointsAfterGeneration()
    }
  }

  return {
    generating,
    isNodeBusy,
    cancelGeneration,
    generateForNode,
    saveSceneComposer,
    expandSceneComposer,
    batchGenerateSceneComposer,
    exportVideoComposition,
    onFallbackPending,
  }
}
