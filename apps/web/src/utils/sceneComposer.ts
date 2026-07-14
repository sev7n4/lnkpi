import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { CanvasEdgeLike } from '@/composables/useUpstreamNodeContext'
import {
  createDefaultSceneComposerPayload,
  normalizeSceneComposerPayload,
  resolveSceneComposerCoverUrl,
  type SceneComposerPayload,
  type SceneComposerScene,
  type SceneComposerShot,
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
      style: { stroke: '#f59e0b' },
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
    style: { stroke: '#6366f1' },
  })
}

export function buildBatchGenerateItems(payload: SceneComposerPayload) {
  const items: Array<{
    shotNodeId: string
    title: string
    prompt: string
    mediaType: 'image' | 'video'
  }> = []

  for (const scene of payload.scenes) {
    for (const shot of scene.shots) {
      if (!shot.shotNodeId || !shot.prompt.trim()) continue
      if (shot.mediaType !== 'image' && shot.mediaType !== 'video') continue
      items.push({
        shotNodeId: shot.shotNodeId,
        title: shot.title || scene.title,
        prompt: shot.prompt.trim(),
        mediaType: shot.mediaType,
      })
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
