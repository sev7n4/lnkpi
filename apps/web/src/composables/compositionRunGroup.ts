export type CompositionRunGroup = {
  nodeIds: string[]
  dumpHash: string
  createdAt: string
}

export type CompositionRunCanvas = {
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> | null }>
  edges: Array<{ id?: string; source: string; target: string }>
  compositionRunGroup?: CompositionRunGroup | null
}

function isSkippedGenerateId(
  id: string,
  node: { type?: string } | undefined,
): boolean {
  if (id.startsWith('image-src-')) return true
  if (id === 'text-p') return true
  if (node?.type === 'text') return true
  return false
}

/** Kahn topo-sort of generating run-group members. Tie-break with original nodeIds order. */
export function orderedCompositionGenerateIds(canvas: CompositionRunCanvas): string[] {
  const raw = canvas.compositionRunGroup?.nodeIds ?? []
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  const members = raw.filter((id) => !isSkippedGenerateId(id, byId.get(id)))
  if (!members.length) return []

  const memberSet = new Set(members)
  const originalIndex = new Map(members.map((id, index) => [id, index]))
  const indegree = new Map(members.map((id) => [id, 0]))
  const outgoing = new Map(members.map((id) => [id, [] as string[]]))

  for (const edge of canvas.edges) {
    if (!memberSet.has(edge.source) || !memberSet.has(edge.target)) continue
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const ready = members.filter((id) => (indegree.get(id) ?? 0) === 0)
  const sortReady = () => {
    ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0))
  }
  sortReady()

  const ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    ordered.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const nextDeg = (indegree.get(next) ?? 1) - 1
      indegree.set(next, nextDeg)
      if (nextDeg === 0) {
        ready.push(next)
        sortReady()
      }
    }
  }

  if (ordered.length < members.length) {
    const seen = new Set(ordered)
    for (const id of members) {
      if (!seen.has(id)) ordered.push(id)
    }
  }
  return ordered
}

/** Dock click: expand generating members to the ordered group; skip text-p; otherwise single-node. */
export function compositionGenerateIdsForClick(
  nodeId: string,
  canvas: CompositionRunCanvas,
): string[] {
  if (nodeId === 'text-p') return []
  const ordered = orderedCompositionGenerateIds(canvas)
  if (ordered.includes(nodeId)) return ordered
  return [nodeId]
}
