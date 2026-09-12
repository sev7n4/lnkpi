import { z } from 'zod'

export const WORKFLOW_FORMAT = 'lnkpi.workflow' as const
export const WORKFLOW_VERSION = '1.0.0' as const

export type MediaRole = 'generated' | 'uploaded' | 'none'

const mediaRoleSchema = z.enum(['generated', 'uploaded', 'none'])

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: positionSchema,
  parentId: z.string().optional(),
  parentNode: z.string().optional(),
  data: z.record(z.unknown()),
  mediaRole: mediaRoleSchema,
})

const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
})

const graphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
})

const mediaIndexEntrySchema = z.object({
  nodeId: z.string(),
  kind: z.string(),
  fileName: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
  persistedUrl: z.string().optional(),
  error: z.string().optional(),
})

export const workflowDocumentSchema = z.object({
  format: z.literal(WORKFLOW_FORMAT),
  version: z.literal(WORKFLOW_VERSION),
  exportedAt: z.string(),
  sourceSessionId: z.string().optional(),
  mode: z.enum(['full', 'subgraph']),
  exportMode: z.enum(['full_package', 'lightweight']),
  graph: graphSchema,
  mediaIndex: z.array(mediaIndexEntrySchema),
})

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>
export type WorkflowNode = z.infer<typeof workflowNodeSchema>
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>
export type MediaIndexEntry = z.infer<typeof mediaIndexEntrySchema>

export interface BuildWorkflowDocumentInput {
  nodes: Array<{
    id: string
    type: string
    position: { x: number; y: number }
    parentId?: string
    parentNode?: string
    data?: Record<string, unknown>
  }>
  edges: Array<{ id: string; source: string; target: string }>
  mode: 'full' | 'subgraph'
  exportMode: 'full_package' | 'lightweight'
  sourceSessionId?: string
  mediaIndex?: MediaIndexEntry[]
}

export function inferMediaRole(data: Record<string, unknown>): MediaRole {
  const versions = data.imageVersions
  if (Array.isArray(versions)) {
    for (const entry of versions) {
      if (entry && typeof entry === 'object' && (entry as { source?: string }).source === 'upload') {
        return 'uploaded'
      }
    }
  }
  if (typeof data.generationRecordId === 'string' && data.generationRecordId.length > 0) {
    return 'generated'
  }
  return 'none'
}

export function buildWorkflowDocument(input: BuildWorkflowDocumentInput): WorkflowDocument {
  const doc: WorkflowDocument = {
    format: WORKFLOW_FORMAT,
    version: WORKFLOW_VERSION,
    exportedAt: new Date().toISOString(),
    mode: input.mode,
    exportMode: input.exportMode,
    graph: {
      nodes: input.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
        ...(node.parentNode !== undefined ? { parentNode: node.parentNode } : {}),
        data: { ...(node.data ?? {}) },
        mediaRole: inferMediaRole(node.data ?? {}),
      })),
      edges: input.edges.map((edge) => ({ ...edge })),
    },
    mediaIndex: (input.mediaIndex ?? []).map((entry) => ({ ...entry })),
  }
  if (input.sourceSessionId !== undefined) {
    doc.sourceSessionId = input.sourceSessionId
  }
  return doc
}

export function validateWorkflow(input: unknown): WorkflowDocument {
  return workflowDocumentSchema.parse(input)
}

/**
 * Recursively replaces string values that exactly equal a known old node id,
 * but only within `localRefs` arrays and `mentionedKeys` (and nested objects
 * therein). Other `data` fields are copied unchanged.
 */
function remapRefStrings(value: unknown, idMap: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return idMap[value] ?? value
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapRefStrings(item, idMap))
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(obj)) {
      next[key] = remapRefStrings(nested, idMap)
    }
    return next
  }
  return value
}

function remapNodeData(
  data: Record<string, unknown>,
  idMap: Record<string, string>,
): Record<string, unknown> {
  const next = { ...data }
  if (Array.isArray(next.localRefs)) {
    next.localRefs = next.localRefs.map((item) => remapRefStrings(item, idMap))
  }
  if (Array.isArray(next.mentionedKeys)) {
    next.mentionedKeys = next.mentionedKeys.map((key) =>
      typeof key === 'string' && idMap[key] !== undefined ? idMap[key] : key,
    )
  }
  return next
}

export function remapWorkflowIds(
  doc: WorkflowDocument,
  createId: (type: string) => string,
): { document: WorkflowDocument; idMap: Record<string, string> } {
  const idMap: Record<string, string> = {}
  for (const node of doc.graph.nodes) {
    idMap[node.id] = createId(node.type)
  }

  const remapNodeId = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined
    return idMap[id] ?? id
  }

  const nodes: WorkflowNode[] = doc.graph.nodes.map((node) => ({
    ...node,
    id: idMap[node.id],
    ...(node.parentId !== undefined ? { parentId: remapNodeId(node.parentId) } : {}),
    ...(node.parentNode !== undefined ? { parentNode: remapNodeId(node.parentNode) } : {}),
    data: remapNodeData(node.data, idMap),
  }))

  const edges: WorkflowEdge[] = doc.graph.edges.map((edge) => ({
    ...edge,
    id: createId('edge'),
    source: idMap[edge.source] ?? edge.source,
    target: idMap[edge.target] ?? edge.target,
  }))

  const mediaIndex: MediaIndexEntry[] = doc.mediaIndex.map((entry) => ({
    ...entry,
    nodeId: idMap[entry.nodeId] ?? entry.nodeId,
  }))

  return {
    document: {
      ...doc,
      graph: { nodes, edges },
      mediaIndex,
    },
    idMap,
  }
}
