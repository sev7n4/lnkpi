import type { FlowEdge, FlowNode } from '@/composables/useCanvasActions'
import { getGroupChildIds, type FlowNode as GroupFlowNode } from '@/composables/useCanvasGrouping'

export type DuplicateFlowNode = FlowNode & {
  parentNode?: string
  selected?: boolean
}

export type DuplicateEdgeMode = 'none' | 'internal' | 'upstream'

export interface DuplicateSubgraphOptions {
  offset?: { x: number; y: number }
  edgeMode?: DuplicateEdgeMode
}

export interface DuplicateSubgraphResult {
  nodes: DuplicateFlowNode[]
  edges: FlowEdge[]
  idMap: Map<string, string>
  newRootIds: string[]
}

const DEFAULT_OFFSET = { x: 48, y: 48 }

const STRIP_DATA_KEYS = [
  'generationRecordId',
  'materialId',
  'errorMessage',
  'errorCode',
  'generationStartedAt',
  'uploadProgress',
] as const

const ACTIVE_STATUSES = new Set([
  'generating',
  'pending',
  'fallback_pending',
  'processing',
  'running',
])

let duplicateCounter = 0

function nextDuplicateId(type: string): string {
  duplicateCounter += 1
  return `${type}-dup-${Date.now()}-${duplicateCounter}`
}

function expandGroupClosure(nodes: DuplicateFlowNode[], ids: string[]): string[] {
  const set = new Set(ids)
  for (const id of [...set]) {
    const node = nodes.find((entry) => entry.id === id)
    if (node?.type !== 'group') continue
    for (const childId of getGroupChildIds(nodes as GroupFlowNode[], id)) {
      set.add(childId)
    }
  }
  return [...set]
}

export function resolveDuplicateSourceIds(
  nodes: DuplicateFlowNode[],
  edges: FlowEdge[],
  contextNodeId: string,
  multiSelectedIds: string[],
  edgeMode: DuplicateEdgeMode = 'internal',
): string[] {
  let ids =
    multiSelectedIds.includes(contextNodeId) && multiSelectedIds.length > 1
      ? [...multiSelectedIds]
      : [contextNodeId]

  ids = expandGroupClosure(nodes, ids)

  if (edgeMode === 'upstream' && ids.length === 1) {
    const seed = ids[0]
    const upstream = edges
      .filter((edge) => edge.target === seed)
      .map((edge) => edge.source)
    ids = [...new Set([seed, ...upstream])]
  }

  return ids.filter((id) => nodes.some((node) => node.id === id))
}

export function sanitizeNodeDataForDuplicate(
  type: string | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = structuredClone(data)
  for (const key of STRIP_DATA_KEYS) {
    delete next[key]
  }
  const mediaType = type === 'image' || type === 'video' || type === 'audio'
  const hasUrl = typeof next.url === 'string' && next.url.trim().length > 0
  if (ACTIVE_STATUSES.has(String(next.status ?? ''))) {
    next.status = mediaType && hasUrl ? 'completed' : 'idle'
  } else if (mediaType && hasUrl) {
    next.status = 'completed'
  }
  next.createdAt = Date.now()
  return next
}

function remapGroupChildIds(
  data: Record<string, unknown>,
  idMap: Map<string, string>,
): Record<string, unknown> {
  const childIds = data.childIds
  if (!Array.isArray(childIds)) return data
  return {
    ...data,
    childIds: childIds
      .map((id) => (typeof id === 'string' ? idMap.get(id) ?? id : id))
      .filter((id): id is string => typeof id === 'string'),
  }
}

export function duplicateSubgraph(
  nodes: DuplicateFlowNode[],
  edges: FlowEdge[],
  sourceIds: string[],
  options?: DuplicateSubgraphOptions,
): DuplicateSubgraphResult {
  const offset = options?.offset ?? DEFAULT_OFFSET
  const edgeMode = options?.edgeMode ?? 'internal'
  const idSet = new Set(expandGroupClosure(nodes, sourceIds))
  const idMap = new Map<string, string>()

  for (const id of idSet) {
    idMap.set(id, nextDuplicateId(String(nodes.find((n) => n.id === id)?.type ?? 'node')))
  }

  const newNodes: DuplicateFlowNode[] = []
  for (const id of idSet) {
    const node = nodes.find((entry) => entry.id === id)
    if (!node) continue
    const sanitized = sanitizeNodeDataForDuplicate(node.type, {
      ...(node.data ?? {}),
    } as Record<string, unknown>)
    const remappedParent =
      node.parentNode && idSet.has(node.parentNode)
        ? idMap.get(node.parentNode)
        : undefined
    newNodes.push({
      id: idMap.get(id)!,
      type: node.type,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      data:
        node.type === 'group'
          ? remapGroupChildIds(sanitized, idMap)
          : sanitized,
      ...(remappedParent ? { parentNode: remappedParent } : {}),
      selected: false,
    })
  }

  // Second pass: ensure group childIds only reference copied children
  for (const node of newNodes) {
    if (node.type !== 'group') continue
    const data = node.data as { childIds?: string[] }
    if (!Array.isArray(data.childIds)) continue
    node.data = {
      ...data,
      childIds: data.childIds.filter((childId) =>
        newNodes.some((copy) => copy.id === childId),
      ),
    }
  }

  const newEdges: FlowEdge[] = []
  if (edgeMode !== 'none') {
    for (const edge of edges) {
      const newSource = idMap.get(edge.source)
      const newTarget = idMap.get(edge.target)
      if (!newSource || !newTarget) continue
      newEdges.push({
        ...edge,
        id: `e-dup-${newSource}-${newTarget}`,
        source: newSource,
        target: newTarget,
      })
    }
  }

  const newRootIds = newNodes
    .filter((node) => !node.parentNode || !idMap.has(node.parentNode))
    .map((node) => node.id)

  return { nodes: newNodes, edges: newEdges, idMap, newRootIds }
}
