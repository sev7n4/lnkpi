import { createHash } from 'node:crypto'
import { validateWorkflow, type WorkflowDocument } from './workflowExchange'

const COMPILE_FAILED_MESSAGE = '这版构图还不能放到画布，请稍后再试或简化步骤。'
const MAX_DUMP_NODES = 24
const SOURCE_ID = /^image-src-/

export type CompositionLintOk = { ok: true }
export type CompositionLintFail = {
  ok: false
  code: 'compile_failed'
  message: string
}
export type CompositionLintResult = CompositionLintOk | CompositionLintFail

function compileFailed(): CompositionLintFail {
  return { ok: false, code: 'compile_failed', message: COMPILE_FAILED_MESSAGE }
}

export function lintCompositionDump(dump: WorkflowDocument): CompositionLintResult {
  try {
    validateWorkflow(dump)
  } catch {
    return compileFailed()
  }

  if (dump.graph.nodes.length > MAX_DUMP_NODES) return compileFailed()
  if (JSON.stringify(dump).includes('data:image')) return compileFailed()
  if (hasCycle(dump.graph.edges)) return compileFailed()

  for (const node of dump.graph.nodes) {
    if (node.data.status !== 'draft') return compileFailed()
    if (SOURCE_ID.test(node.id) && node.data.genMode !== undefined) return compileFailed()
  }

  return { ok: true }
}

export function hashCompositionDump(dump: WorkflowDocument): string {
  return createHash('sha256').update(JSON.stringify(dump)).digest('hex')
}

export function summarizeCompositionDump(
  dump: WorkflowDocument,
  opts: { existingNodeCount: number },
): string {
  const ids = dump.graph.nodes.map((node) => node.id)
  const added = ids.filter((id) => !id.startsWith('image-src-')).length
  const parts = ['请确认是否把构图落到画布']

  if (ids.includes('image-i0')) {
    parts.push('新建白底三视图')
  } else if (ids.some((id) => id.startsWith('image-look-'))) {
    parts.push('沿用 I1 作为 I0')
  }

  parts.push(`保留 ${opts.existingNodeCount}`)
  parts.push(`新增 ${added}`)
  return parts.join('\n')
}

function hasCycle(edges: Array<{ source: string; target: string }>): boolean {
  const adj = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const edge of edges) {
    nodes.add(edge.source)
    nodes.add(edge.target)
    const next = adj.get(edge.source)
    if (next) next.push(edge.target)
    else adj.set(edge.source, [edge.target])
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  for (const id of nodes) {
    if (dfs(id)) return true
  }
  return false
}
