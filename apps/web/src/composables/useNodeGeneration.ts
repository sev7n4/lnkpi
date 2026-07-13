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
import { parseRecordText, parseRecordUrl, type GenerationPollTask } from '@/composables/useGenerationPolling'
import { canvasApi } from '@/services/canvas-api'
import { studioApi } from '@/services/studio-api'

export interface NodeGenerationDeps {
  nodes: Ref<EditableFlowNode[]>
  edges: Ref<CanvasEdgeLike[]>
  sessionId: Ref<string>
  patchNodeData: (id: string, patch: Record<string, unknown>) => void
  addNode: (type: string, data: Record<string, unknown>, opts?: { id?: string; position?: { x: number; y: number } }) => void
  addEdge: (edge: CanvasEdgeLike & { id: string; style?: Record<string, string | number> }) => void
  saveCanvas: () => Promise<void>
  requireLogin: () => boolean
  startShotPolling: (shotIds: string[]) => void
  startGenerationPolling: (tasks: GenerationPollTask[]) => void
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
    const upstream = resolveUpstreamContext(node.id, deps.nodes.value, deps.edges.value)
    const prompt = mergePromptWithUpstream(data, upstream)
    if (!prompt) return
    if (!deps.requireLogin()) return

    generating.value = true
    const nodeType = String(node.type)

    try {
      if (nodeType === 'text') {
        deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, content: prompt, prompt })
        const { data: res } = await studioApi.generateText(prompt, String(data.textModel ?? 'gpt-4o'))
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
        deps.patchNodeData(node.id, { prompt, status: NODE_GENERATION_STATUS.draft })
        await deps.saveCanvas()
        return
      }

      if (nodeType === 'image' || nodeType === 'video') {
        await generateImageOrVideo(node, prompt, data, upstream)
        return
      }

      if (nodeType === 'shot') {
        await generateShot(node, prompt, data)
      }
    } catch {
      deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.error })
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
      const { data: res } = await studioApi.generateImage(
        imagePrompt,
        String(data.imageModel ?? 'flux-pro'),
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
    const { data: res } = await studioApi.generateVideo(
      videoPrompt,
      String(data.videoModel ?? 'kling-v1'),
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

  return {
    generating,
    generateForNode,
  }
}
