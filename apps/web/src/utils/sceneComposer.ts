import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { CanvasEdgeLike } from '@/composables/useUpstreamNodeContext'
import { resolveNodeRefs, type LocalRefBinding } from '@/composables/useNodeRefs'
import { parseRefMentions } from '@/composables/useRefMentions'
import { resolveGenerationModel } from '@/constants/studioModels'
import {
  createDefaultSceneComposerPayload,
  DEFAULT_VIDEO_SETTINGS,
  normalizeSceneComposerPayload,
  resolveSceneComposerCoverUrl,
  type GenerationRefPayload,
  type SceneComposerBatchItem,
  type SceneComposerPayload,
  type SceneComposerScene,
  type SceneComposerShot,
  type VideoSettings,
} from '@lnkpi/shared'

export interface SceneComposerExpandDeps {
  nodes: EditableFlowNode[]
  addNode: (
    type: string,
    data: Record<string, unknown>,
    opts?: { id?: string; position?: { x: number; y: number } },
  ) => string
  addEdge: (edge: CanvasEdgeLike & { id: string; style?: Record<string, string | number> }) => void
  imageModel: string
  videoModel: string
}

function findNode(nodes: EditableFlowNode[], id: string) {
  return nodes.find((node) => node.id === id) ?? null
}

export function readSceneComposerFromNode(node: EditableFlowNode): SceneComposerPayload {
  const data = node.data ?? {}
  return normalizeSceneComposerPayload({
    title: data.title,
    prompt: data.prompt,
    coverUrl: data.coverUrl,
    scenes: data.scenes,
    expanded: data.expanded,
    expandedAt: data.expandedAt,
  })
}

export function sceneComposerToNodePatch(payload: SceneComposerPayload) {
  return {
    title: payload.title,
    prompt: payload.prompt,
    scenes: payload.scenes,
    coverUrl: resolveSceneComposerCoverUrl(payload),
    expanded: payload.expanded,
    expandedAt: payload.expandedAt,
  }
}

export function expandSceneComposerGraph(
  composerNode: EditableFlowNode,
  payload: SceneComposerPayload,
  deps: SceneComposerExpandDeps,
): SceneComposerPayload {
  const next = structuredClone(payload)
  let shotIndex = 0
  const baseX = composerNode.position.x
  const baseY = composerNode.position.y

  for (const scene of next.scenes) {
    for (const shot of scene.shots) {
      expandSingleShot(composerNode.id, scene, shot, shotIndex, baseX, baseY, deps)
      shotIndex += 1
    }
  }

  next.expanded = true
  next.expandedAt = new Date().toISOString()
  next.coverUrl = resolveSceneComposerCoverUrl(next)
  return next
}

function expandSingleShot(
  composerNodeId: string,
  scene: SceneComposerScene,
  shot: SceneComposerShot,
  shotIndex: number,
  baseX: number,
  baseY: number,
  deps: SceneComposerExpandDeps,
) {
  const col = shotIndex % 3
  const row = Math.floor(shotIndex / 3)
  const shotX = baseX + 340 + col * 320
  const shotY = baseY + row * 240

  let shotNodeId = shot.shotNodeId
  if (shotNodeId && findNode(deps.nodes, shotNodeId)) {
    // already on canvas
  } else {
    shotNodeId = deps.addNode(
      'shot',
      {
        title: shot.title || scene.title,
        prompt: shot.prompt,
        status: 'draft',
        order: shotIndex,
        sceneComposerId: composerNodeId,
        sceneId: scene.id,
        shotId: shot.id,
      },
      { id: shotNodeId, position: { x: shotX, y: shotY } },
    )
    shot.shotNodeId = shotNodeId
    deps.addEdge({
      id: `e-${composerNodeId}-${shotNodeId}`,
      source: composerNodeId,
      target: shotNodeId,
    })
  }

  if (shot.mediaType === 'none') return

  const childType = shot.mediaType === 'video' ? 'video' : 'image'
  const childX = shotX + 300
  const childY = shotY
  const existingChildId = childType === 'video' ? shot.videoNodeId : shot.imageNodeId

  if (existingChildId && findNode(deps.nodes, existingChildId)) return

  const childId = deps.addNode(
    childType,
    childType === 'video'
      ? {
          url: '',
          status: 'idle',
          prompt: shot.prompt,
          videoModel: deps.videoModel,
        }
      : {
          url: '',
          status: 'idle',
          prompt: shot.prompt,
          imageModel: deps.imageModel,
        },
    { id: existingChildId, position: { x: childX, y: childY } },
  )

  if (childType === 'video') shot.videoNodeId = childId
  else shot.imageNodeId = childId

  deps.addEdge({
    id: `e-${shotNodeId}-${childId}`,
    source: shotNodeId,
    target: childId,
  })
}

export function resolveCanvasImageParams(data: Record<string, unknown>) {
  return {
    model: resolveGenerationModel('image', data.imageModel as string | undefined),
    aspectRatio: String(data.imageAspect ?? '16:9'),
    resolution: String(data.imageResolution ?? '1K'),
    count: 1 as const,
  }
}

export function resolveCanvasVideoParams(
  data: Record<string, unknown>,
): Partial<VideoSettings> & { model: string } {
  const settings = (data.videoSettings as Partial<VideoSettings> | undefined) ?? {}
  return {
    model: resolveGenerationModel('video', data.videoModel as string | undefined),
    duration: settings.duration ?? DEFAULT_VIDEO_SETTINGS.duration,
    aspectRatio: settings.aspectRatio ?? DEFAULT_VIDEO_SETTINGS.aspectRatio,
    resolution: settings.resolution ?? DEFAULT_VIDEO_SETTINGS.resolution,
    crop: settings.crop ?? DEFAULT_VIDEO_SETTINGS.crop,
  }
}

export interface BuildBatchGenerateItemsOptions {
  nodes?: EditableFlowNode[]
  edges?: CanvasEdgeLike[]
  composerNodeId?: string
}

function normalizeEdges(edges: CanvasEdgeLike[]) {
  return edges.map((edge) => ({
    id: edge.id ?? `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
  }))
}

function nodeLocalPrompt(data: Record<string, unknown>): string {
  return String(data.prompt ?? data.content ?? '').trim()
}

export function toGenerationRefs(
  node: EditableFlowNode,
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
): GenerationRefPayload[] {
  const data = node.data ?? {}
  return resolveNodeRefs({
    targetNodeId: node.id,
    targetType: String(node.type),
    nodes,
    edges: normalizeEdges(edges),
    localRefs: (data.localRefs as LocalRefBinding[]) ?? [],
    refOrder: (data.refOrder as string[]) ?? [],
  })
    .filter((ref) => !ref.stale)
    .map((ref) => ({
      refKey: ref.refKey,
      mediaType: ref.mediaType,
      label: ref.label,
      text: ref.payload.text,
      url: ref.payload.url,
    }))
}

function findMediaChildNode(
  nodes: EditableFlowNode[],
  shot: SceneComposerShot,
  mediaType: 'image' | 'video',
): EditableFlowNode | null {
  const nodeId = mediaType === 'video' ? shot.videoNodeId : shot.imageNodeId
  if (!nodeId) return null
  return findNode(nodes, nodeId)
}

export function buildBatchGenerateItems(
  payload: SceneComposerPayload,
  options?: BuildBatchGenerateItemsOptions,
): SceneComposerBatchItem[] {
  const nodes = options?.nodes ?? []
  const edges = options?.edges ?? []
  const composerNode = options?.composerNodeId
    ? findNode(nodes, options.composerNodeId)
    : null
  const items: SceneComposerBatchItem[] = []

  for (const scene of payload.scenes) {
    for (const shot of scene.shots) {
      if (!shot.shotNodeId || !shot.prompt.trim()) continue
      if (shot.mediaType !== 'image' && shot.mediaType !== 'video') continue

      const childNode = findMediaChildNode(nodes, shot, shot.mediaType)
      const childData = childNode?.data ?? {}
      const refsTarget = childNode ?? composerNode
      const refs = refsTarget ? toGenerationRefs(refsTarget, nodes, edges) : []
      const finalPrompt = childNode
        ? nodeLocalPrompt(childData) || shot.prompt.trim()
        : shot.prompt.trim()
      const mentionedKeys = parseRefMentions(finalPrompt)

      if (shot.mediaType === 'image') {
        const params = resolveCanvasImageParams(childNode ? childData : {})
        items.push({
          shotNodeId: shot.shotNodeId,
          title: shot.title || scene.title,
          prompt: finalPrompt,
          mediaType: 'image',
          model: params.model,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          count: params.count,
          refs,
          mentionedKeys,
        })
      } else {
        const params = resolveCanvasVideoParams(childNode ? childData : {})
        items.push({
          shotNodeId: shot.shotNodeId,
          title: shot.title || scene.title,
          prompt: finalPrompt,
          mediaType: 'video',
          model: params.model,
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          crop: params.crop,
          refs,
          mentionedKeys,
        })
      }
    }
  }

  return items
}

export function createInitialSceneComposerNodeData(
  partial?: Record<string, unknown>,
): Record<string, unknown> {
  const payload = createDefaultSceneComposerPayload(
    normalizeSceneComposerPayload(partial ?? null),
  )
  return {
    ...sceneComposerToNodePatch(payload),
    status: 'draft',
  }
}
