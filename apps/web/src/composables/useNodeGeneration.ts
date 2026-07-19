import { ref, type Ref } from 'vue'
import type { VideoSettings } from '@lnkpi/shared'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { DEFAULT_AUDIO_VOICE } from '@/constants/dockAudio'
import {
  mergePromptWithUpstream,
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
import { studioApi, type StudioRefPayload } from '@/services/studio-api'
import { defaultModelKey, resolveModelKey } from '@/constants/studioModels'
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
  resolveProviderModels: () => { image: string; video: string; text: string }
}

function localPrompt(data: Record<string, unknown>): string {
  return String(data.prompt ?? data.content ?? '').trim()
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

export function useNodeGeneration(deps: NodeGenerationDeps) {
  const generating = ref(false)

  async function generateForNode(node: EditableFlowNode) {
    const data = node.data ?? {}
    const nodeType = String(node.type)
    const upstream = resolveUpstreamContext(node.id, deps.nodes.value, deps.edges.value)
    const local = localPrompt(data)
    const refs = resolveStudioRefs(node, deps.nodes.value, deps.edges.value)
    const mentionedKeys = parseRefMentions(local)
    const canvasPrompt = mergePromptWithUpstream(data, upstream)
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

    generating.value = true

    try {
      if (nodeType === 'prompt') {
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
        const { data: res } = await studioApi.generatePrompt(
          local,
          resolveModelKey('text', data.textModel as string | undefined).modelKey,
        )
        const parsed = parseRecordPromptContent(res.data)
        deps.patchNodeData(node.id, {
          content: parsed.content,
          promptMode: parsed.mode,
          status: NODE_GENERATION_STATUS.completed,
          errorMessage: null,
        })
        await deps.saveCanvas()
        return
      }

      if (nodeType === 'text') {
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, content: local, prompt: local })
        const { data: res } = await studioApi.generateText(
          local,
          resolveModelKey('text', data.textModel as string | undefined).modelKey,
          refs,
          mentionedKeys,
        )
        const content = parseRecordText(res.data)
        deps.patchNodeData(node.id, {
          content,
          prompt: content,
          status: NODE_GENERATION_STATUS.completed,
        })
        await deps.saveCanvas()
        return
      }

      if (nodeType === 'audio') {
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt: local })
        const { data: res } = await studioApi.generateAudio(local, {
          model: String(data.audioModel ?? defaultModelKey('audio')),
          voice: String(data.audioVoice ?? DEFAULT_AUDIO_VOICE),
          emotion: String(data.audioEmotion ?? 'neutral'),
          language: String(data.audioLanguage ?? 'zh'),
          speed: typeof data.audioSpeed === 'number' ? data.audioSpeed : 1,
          volume: typeof data.audioVolume === 'number' ? data.audioVolume : 1,
          pitch: typeof data.audioPitch === 'number' ? data.audioPitch : 0,
        }, refs, mentionedKeys)
        deps.patchNodeData(node.id, {
          url: parseRecordUrl(res.data),
          status: NODE_GENERATION_STATUS.completed,
          prompt: local,
        })
        await deps.saveCanvas()
        return
      }

      if (nodeType === 'sceneComposer') {
        await saveSceneComposer(node)
        return
      }

      if (nodeType === 'image' || nodeType === 'video') {
        await generateImageOrVideo(node, local, data, upstream, refs, mentionedKeys)
        return
      }

      if (nodeType === 'shot') {
        await generateShot(node, canvasPrompt, data)
      }
    } catch (err) {
      console.error('[NodeGeneration]', nodeType, err)
      deps.patchNodeData(node.id, {
        status: NODE_GENERATION_STATUS.error,
        errorMessage: err instanceof Error ? err.message : '生成失败',
      })
    } finally {
      generating.value = false
    }
  }

  async function generateImageOrVideo(
    node: EditableFlowNode,
    prompt: string,
    data: Record<string, unknown>,
    upstream: ReturnType<typeof resolveUpstreamContext>,
    refs: StudioRefPayload[],
    mentionedKeys: string[],
  ) {
    const nodeType = String(node.type)
    const linkedShotEdge = findIncomingEdge(deps.edges.value, node.id)
    const shotId = linkedShotEdge?.source
    const shotNode = shotId ? findNodeById(deps.nodes.value, shotId) : null
    const canvasPrompt = mergePromptWithUpstream(data, upstream)

    if (shotNode?.type === 'shot' && shotId) {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt: canvasPrompt })
      deps.patchNodeData(shotId, { status: NODE_GENERATION_STATUS.generating, prompt: canvasPrompt })
      if (nodeType === 'video') {
        const params = resolveCanvasVideoParams(data)
        await canvasApi.generateVideo(shotId, canvasPrompt, params)
      } else {
        const params = resolveCanvasImageParams(data)
        await canvasApi.generateImage(shotId, canvasPrompt, params)
      }
      deps.startShotPolling([shotId])
      await deps.saveCanvas()
      return
    }

    deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt })

    const refImage = firstImageRefUrl(refs) || mergeReferenceImageUrl(data, upstream)

    if (nodeType === 'image') {
      const aspectRatio = String(data.imageAspect ?? '16:9')
      const resolution = String(data.imageResolution ?? '1K')
      const count = Number(data.imageCount ?? 1)
      const { data: res } = await studioApi.generateImage(
        prompt,
        resolveModelKey('image', data.imageModel as string | undefined).modelKey,
        aspectRatio,
        refs,
        mentionedKeys,
        resolution,
        count,
      )
      const urls = parseRecordUrls(res.data)
      deps.patchNodeData(node.id, {
        url: urls[0] ?? parseRecordUrl(res.data),
        images: urls,
        status: NODE_GENERATION_STATUS.completed,
        referenceImageUrl: refImage || undefined,
        imageResolution: resolution,
        imageCount: count,
      })
      await deps.saveCanvas()
      return
    }

    const settings = data.videoSettings as VideoSettings | undefined
    const { data: res } = await studioApi.generateVideo(
      prompt,
      resolveModelKey('video', data.videoModel as string | undefined).modelKey,
      settings?.duration,
      settings?.aspectRatio,
      refs,
      mentionedKeys,
      settings?.resolution,
      settings?.crop,
    )
    const url = parseRecordUrl(res.data)
    const recordId = res.data.id
    if (res.data.status === NODE_GENERATION_STATUS.completed && url) {
      deps.patchNodeData(node.id, {
        url,
        status: NODE_GENERATION_STATUS.completed,
        referenceImageUrl: refImage || undefined,
        generationRecordId: recordId,
      })
    } else {
      deps.patchNodeData(node.id, {
        status: NODE_GENERATION_STATUS.generating,
        referenceImageUrl: refImage || undefined,
        generationRecordId: recordId,
      })
      deps.startGenerationPolling([{ recordId, nodeId: node.id }])
    }
    await deps.saveCanvas()
  }

  async function generateShot(node: EditableFlowNode, prompt: string, data: Record<string, unknown>) {
    deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt })
    const title = String(data.title ?? (prompt.slice(0, 24) || '新分镜'))
    try {
      await canvasApi.editShot(node.id, { title, prompt })
    } catch {
      const shotRes = await canvasApi.createShot(deps.sessionId.value, { title, prompt })
      const shot = shotRes.data.data as { id: string }
      if (shot.id !== node.id) {
        deps.patchNodeData(node.id, { title, prompt, status: NODE_GENERATION_STATUS.generating })
      }
    }

    const hasVideoChild = shotHasChildType(deps.nodes.value, deps.edges.value, node.id, 'video')
    const hasImageChild = shotHasChildType(deps.nodes.value, deps.edges.value, node.id, 'image')
    const mode = String(data.shotGenerateMode ?? 'auto')

    const shouldGenerateVideo = mode === 'video' || (mode === 'auto' && hasVideoChild)
    const shouldGenerateImage = mode === 'image' || (mode === 'auto' && hasImageChild && !shouldGenerateVideo)

    if (shouldGenerateVideo) {
      const childNode = findShotMediaChild(deps.nodes.value, deps.edges.value, node.id, 'video')
      const params = resolveCanvasVideoParams(childNode?.data ?? {})
      await canvasApi.generateVideo(node.id, prompt, params)
    } else if (shouldGenerateImage) {
      const childNode = findShotMediaChild(deps.nodes.value, deps.edges.value, node.id, 'image')
      const params = resolveCanvasImageParams(childNode?.data ?? {})
      await canvasApi.generateImage(node.id, prompt, params)
    } else {
      const params = resolveCanvasImageParams({})
      const matRes = await canvasApi.generateImage(node.id, prompt, params)
      const material = matRes.data.data as { id: string }
      deps.addNode('image', { url: '', status: NODE_GENERATION_STATUS.generating, prompt }, {
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
    generating.value = true
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
    } catch {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.error })
    } finally {
      generating.value = false
    }
  }

  async function batchGenerateSceneComposer(node: EditableFlowNode) {
    if (!deps.requireLogin()) return
    generating.value = true
    try {
      const payload = readSceneComposerFromNode(node)
      const items = buildBatchGenerateItems(payload, { nodes: deps.nodes.value })
      if (!items.length) return

      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
      for (const item of items) {
        deps.patchNodeData(item.shotNodeId, { status: NODE_GENERATION_STATUS.generating, prompt: item.prompt })
      }

      await canvasApi.batchGenerateSceneComposer({
        sessionId: deps.sessionId.value,
        composerNodeId: node.id,
        items,
      })

      deps.startShotPolling(items.map((item) => item.shotNodeId))
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
      await deps.saveCanvas()
    } catch {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.error })
    } finally {
      generating.value = false
    }
  }

  async function exportVideoComposition(node: EditableFlowNode, tracks: CompositionTrack[]) {
    if (!deps.requireLogin()) return
    const ordered = applyTrackOrder(tracks, node.data?.trackOrder as string[] | undefined)
    const exportTracks = ordered.filter((track) => track.url.trim())
    if (!exportTracks.length) return

    generating.value = true
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
      const result = res.data as { url: string; durationSec: number }
      deps.patchNodeData(node.id, {
        url: result.url,
        exportDurationSec: result.durationSec,
        status: NODE_GENERATION_STATUS.completed,
        exportedAt: new Date().toISOString(),
      })
      await deps.saveCanvas()
    } catch {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.error })
    } finally {
      generating.value = false
    }
  }

  return {
    generating,
    generateForNode,
    saveSceneComposer,
    expandSceneComposer,
    batchGenerateSceneComposer,
    exportVideoComposition,
  }
}
