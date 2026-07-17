export type RefMediaType = 'text' | 'image' | 'video' | 'audio'
export type RefSourceKind = 'edge' | 'asset' | 'upload'

export interface NodeRef {
  refId: string
  refKey: string // 'T1' | 'I1' | ...
  mediaType: RefMediaType
  sourceKind: RefSourceKind
  label: string
  preview: string
  payload: { text?: string; url?: string }
  edgeId?: string
  sourceNodeId?: string
  stale?: boolean
}

export interface LocalRefBinding {
  id: string
  mediaType: RefMediaType
  sourceKind: 'asset' | 'upload'
  label: string
  url?: string
  text?: string
}

export interface ResolveNodeRefsInput {
  targetNodeId: string
  targetType: string
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string }>
  localRefs?: LocalRefBinding[]
  refOrder?: string[] // refId 顺序
}

type NodeRefDraft = Omit<NodeRef, 'refKey'>

const REF_KEY_PREFIX: Record<RefMediaType, string> = {
  text: 'T',
  image: 'I',
  video: 'V',
  audio: 'A',
}

function trimString(value: unknown): string {
  return String(value ?? '').trim()
}

function nodeLabel(node: { id: string; type?: string; data?: Record<string, unknown> }): string {
  const data = node.data ?? {}
  const explicit = trimString(data.label ?? data.title ?? data.name)
  if (explicit) return explicit
  const type = trimString(node.type)
  if (type) return type
  return node.id
}

function textPreview(text: string): string {
  if (text.length <= 80) return text
  return `${text.slice(0, 77)}...`
}

function resolveTextPayload(data: Record<string, unknown>): string {
  return trimString(data.content) || trimString(data.prompt)
}

function resolveUrlPayload(data: Record<string, unknown>): string {
  return trimString(data.url)
}

function resolveEdgeRef(
  edge: { id: string; source: string; target: string },
  sourceNode: { id: string; type?: string; data?: Record<string, unknown> },
): NodeRefDraft | null {
  const type = trimString(sourceNode.type)
  const data = sourceNode.data ?? {}
  const refId = edge.id

  if (type === 'text' || type === 'prompt') {
    const text = resolveTextPayload(data)
    return {
      refId,
      mediaType: 'text',
      sourceKind: 'edge',
      label: nodeLabel(sourceNode),
      preview: textPreview(text),
      payload: text ? { text } : {},
      edgeId: edge.id,
      sourceNodeId: sourceNode.id,
      stale: !text,
    }
  }

  if (type === 'image' || type === 'mediaInput') {
    const url = resolveUrlPayload(data)
    return {
      refId,
      mediaType: 'image',
      sourceKind: 'edge',
      label: nodeLabel(sourceNode),
      preview: url,
      payload: url ? { url } : {},
      edgeId: edge.id,
      sourceNodeId: sourceNode.id,
      stale: !url,
    }
  }

  if (type === 'video') {
    const url = resolveUrlPayload(data)
    return {
      refId,
      mediaType: 'video',
      sourceKind: 'edge',
      label: nodeLabel(sourceNode),
      preview: url,
      payload: url ? { url } : {},
      edgeId: edge.id,
      sourceNodeId: sourceNode.id,
      stale: !url,
    }
  }

  if (type === 'audio') {
    const url = resolveUrlPayload(data)
    return {
      refId,
      mediaType: 'audio',
      sourceKind: 'edge',
      label: nodeLabel(sourceNode),
      preview: url,
      payload: url ? { url } : {},
      edgeId: edge.id,
      sourceNodeId: sourceNode.id,
      stale: !url,
    }
  }

  return null
}

function resolveLocalRef(binding: LocalRefBinding): NodeRefDraft {
  const text = trimString(binding.text)
  const url = trimString(binding.url)
  const isText = binding.mediaType === 'text'

  return {
    refId: binding.id,
    mediaType: binding.mediaType,
    sourceKind: binding.sourceKind,
    label: binding.label,
    preview: isText ? textPreview(text) : url,
    payload: isText ? (text ? { text } : {}) : url ? { url } : {},
    stale: isText ? !text : !url,
  }
}

function applyRefOrder(refs: NodeRefDraft[], refOrder?: string[]): NodeRefDraft[] {
  if (!refOrder?.length) return refs

  const orderIndex = new Map(refOrder.map((id, index) => [id, index]))
  const ordered: NodeRefDraft[] = []
  const appended: NodeRefDraft[] = []

  for (const ref of refs) {
    if (orderIndex.has(ref.refId)) {
      ordered.push(ref)
    } else {
      appended.push(ref)
    }
  }

  ordered.sort((a, b) => orderIndex.get(a.refId)! - orderIndex.get(b.refId)!)
  return [...ordered, ...appended]
}

export function assignRefKeys(refs: NodeRefDraft[]): NodeRef[] {
  const counters: Record<RefMediaType, number> = {
    text: 0,
    image: 0,
    video: 0,
    audio: 0,
  }

  return refs.map((ref) => {
    counters[ref.mediaType] += 1
    return {
      ...ref,
      refKey: `${REF_KEY_PREFIX[ref.mediaType]}${counters[ref.mediaType]}`,
    }
  })
}

export function resolveNodeRefs(input: ResolveNodeRefsInput): NodeRef[] {
  const nodeMap = new Map(input.nodes.map((node) => [node.id, node]))
  const drafts: NodeRefDraft[] = []

  for (const edge of input.edges) {
    if (edge.target !== input.targetNodeId) continue
    const sourceNode = nodeMap.get(edge.source)
    if (!sourceNode) continue
    const draft = resolveEdgeRef(edge, sourceNode)
    if (draft) drafts.push(draft)
  }

  for (const binding of input.localRefs ?? []) {
    drafts.push(resolveLocalRef(binding))
  }

  return assignRefKeys(applyRefOrder(drafts, input.refOrder))
}
