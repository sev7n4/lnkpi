import { ref, type Ref } from 'vue'
import type { VideoSettings } from '@lnkpi/shared'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import {
  buildPromptWithRefImage,
  mergePromptWithUpstream,
  mergeReferenceImageUrl,
  resolveUpstreamContext,
  resolveVideoMode,
  type CanvasEdgeLike,
} from '@/composables/useUpstreamNodeContext'
import {
  parseRecordPromptContent,
  parseRecordText,
  parseRecordUrl,
  type GenerationPollTask,
} from '@/composables/useGenerationPolling'
import { canvasApi } from '@/services/canvas-api'
import { studioApi } from '@/services/studio-api'
import type { CompositionTrack } from '@/utils/compositionUpstream'
import { applyTrackOrder } from '@/utils/compositionUpstream'
import {
  buildBatchGenerateItems,
  expandSceneComposerGraph,
  readSceneComposerFromNode,
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

function shotHasChildType(nodes: EditableFlowNode[], edges: CanvasEdgeLike[], shotId: string, childType: string) {
  for (const edge of edges) {
    if (edge.source !== shotId) continue
    const target = findNodeById(nodes, edge.target)
    if (target?.type === childType) return true
  }
  return false
}

export function useNodeGeneration(deps: NodeGenerationDeps) {
  const generating = ref(false)

  async function generateForNode(node: EditableFlowNode) {
    const data = node.data ?? {}
    const nodeType = String(node.type)
    const upstream = resolveUpstreamContext(node.id, deps.nodes.value, deps.edges.value)
    const prompt = mergePromptWithUpstream(data, upstream)
    if (!deps.requireLogin()) return
    if (nodeType !== 'sceneComposer' && !prompt) return

    generating.value = true

    try {
      if (nodeType === 'prompt') {
        const userPrompt = String(data.prompt ?? '').trim() || prompt
        if (!userPrompt) return
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
        const models = deps.resolveProviderModels()
        const { data: res } = await studioApi.generatePrompt(
          userPrompt,
          String(data.textModel ?? models.text),
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
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, content: prompt, prompt })
        const models = deps.resolveProviderModels()
        const { data: res } = await studioApi.generateText(
          prompt,
          String(data.textModel ?? models.text),
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
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt })
        const { data: res } = await studioApi.generateAudio(prompt, {
          voice: String(data.audioVoice ?? 'female-1'),
          emotion: String(data.audioEmotion ?? 'neutral'),
          language: String(data.audioLanguage ?? 'zh'),
          speed: typeof data.audioSpeed === 'number' ? data.audioSpeed : 1,
        })
        deps.patchNodeData(node.id, {
          url: parseRecordUrl(res.data),
          status: NODE_GENERATION_STATUS.completed,
          prompt,
        })
        await deps.saveCanvas()
        return
      }

      if (nodeType === 'sceneComposer') {
        await saveSceneComposer(node)
        return
      }

      if (nodeType === 'image' || nodeType === 'video') {
        await generateImageOrVideo(node, prompt, data, upstream)
        return
      }

      if (nodeType === 'shot') {
        await generateShot(node, prompt, data)
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
  ) {
    const nodeType = String(node.type)
    const linkedShotEdge = findIncomingEdge(deps.edges.value, node.id)
    const shotId = linkedShotEdge?.source
    const shotNode = shotId ? findNodeById(deps.nodes.value, shotId) : null

    if (shotNode?.type === 'shot' && shotId) {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt })
      deps.patchNodeData(shotId, { status: NODE_GENERATION_STATUS.generating, prompt })
      if (nodeType === 'video') {
        const settings = data.videoSettings as VideoSettings | undefined
        await canvasApi.generateVideo(shotId, prompt, settings)
      } else {
        await canvasApi.generateImage(shotId, prompt)
      }
      deps.startShotPolling([shotId])
      await deps.saveCanvas()
      return
    }

    deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt })

    if (nodeType === 'image') {
      const refImage = mergeReferenceImageUrl(data, upstream)
      const imagePrompt = buildPromptWithRefImage(prompt, refImage)
      const aspectRatio = String(data.imageAspect ?? '16:9')
      const models = deps.resolveProviderModels()
      const { data: res } = await studioApi.generateImage(
        imagePrompt,
        String(data.imageModel ?? models.image),
        aspectRatio,
      )
      deps.patchNodeData(node.id, {
        url: parseRecordUrl(res.data),
        status: NODE_GENERATION_STATUS.completed,
        referenceImageUrl: refImage || undefined,
      })
      await deps.saveCanvas()
      return
    }

    const settings = data.videoSettings as VideoSettings | undefined
    const videoMode = resolveVideoMode(data, upstream)
    const refImage = videoMode === 'image_to_video' ? mergeReferenceImageUrl(data, upstream) : ''
    const videoPrompt = buildPromptWithRefImage(prompt, refImage)
    const models = deps.resolveProviderModels()
    const { data: res } = await studioApi.generateVideo(
      videoPrompt,
      String(data.videoModel ?? models.video),
      settings?.duration,
      settings?.aspectRatio,
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
      const settings = data.videoSettings as VideoSettings | undefined
      await canvasApi.generateVideo(node.id, prompt, settings)
    } else if (shouldGenerateImage) {
      await canvasApi.generateImage(node.id, prompt)
    } else {
      const matRes = await canvasApi.generateImage(node.id, prompt)
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
      const items = buildBatchGenerateItems(payload)
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
