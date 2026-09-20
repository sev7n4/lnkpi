/**
 * v3 spec §4 规划器
 * 纯函数；无副作用；不依赖 web/vue。
 */

import { getGroupChildIds, type GroupChildNode } from './groupChildIds'
export class SelectionBatchLimitError extends Error {
  readonly code = 'SelectionBatchLimitError'
  constructor(public readonly actualCount: number) {
    super(`Selection batch run count ${actualCount} exceeds 24`)
  }
}

export class SelectionBatchPendingConfirmError extends Error {
  readonly code = 'SelectionBatchPendingConfirmError'
  constructor(public readonly pendingCount: number) {
    super(`Selection contains ${pendingCount} pending_confirm node(s); user must confirm via sidebar first`)
  }
}

export type SkipReason =
  | { nodeId: string; reason: 'already_done' }
  | { nodeId: string; reason: 'unsupported_type'; type: string }
  | { nodeId: string; reason: 'fallback_pending' }
  | { nodeId: string; reason: 'missing_upstream'; ref: string }
  | { nodeId: string; reason: 'in_flight' }
  | { nodeId: string; reason: 'upstream_in_flight'; ref: string }
  | { nodeId: string; reason: 'node_disappeared' }
  | { nodeId: string; reason: 'user_stopped' }

export interface PlanSelectionGenerateInput {
  selectedIds: string[]
  canvas: {
    nodes: ReadonlyArray<{ id: string; type: string; parentNode?: string; data?: Record<string, unknown> }>
    edges: ReadonlyArray<{ id: string; source: string; target: string }>
  }
  hasUsableOutput: (node: { id: string; type: string; data?: Record<string, unknown> }) => boolean
  isInFlight?: (nodeId: string) => boolean
  /**
   * 批量重新生成：already_done 节点不再 skip，进 run（覆盖式重新生成）。
   * pending_confirm 整批拒绝（SB-D3）与 24 上限计数均不受影响。
   * 缺省 false，保持既有行为。
   */
  regenerate?: boolean
}

export interface PlanSelectionGenerateResult {
  run: string[]
  skip: SkipReason[]
  blockedBy: Array<{ source: string; target: string; reason: 'cycle' | 'upstream_missing' }>
  groupExpanded: Array<{ groupId: string; childIds: string[] }>
}

const UNSUPPORTED_TYPES = new Set(['mediaInput', 'sceneComposer', 'videoComposition', 'worldModel', 'group'])
const SUPPORTED_TYPES = new Set(['image', 'video', 'audio', 'prompt', 'text', 'shot'])

interface RawNode { id: string; type: string; parentNode?: string; data?: Record<string, unknown> }

function expandSelection(
  selectedIds: string[],
  nodes: ReadonlyArray<RawNode>,
  skip: SkipReason[],
  groupExpanded: PlanSelectionGenerateResult['groupExpanded'],
): RawNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const result: RawNode[] = []
  for (const id of selectedIds) {
    const node = nodeById.get(id)
    if (!node) {
      // 选中的节点不在 canvas（已删）→ 当作 disappeared
      skip.push({ nodeId: id, reason: 'node_disappeared' })
      continue
    }
    if (node.type === 'group') {
      const childIds = getGroupChildIds(nodes as GroupChildNode[], id)
      groupExpanded.push({ groupId: id, childIds })
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
      for (const cid of childIds) {
        const child = nodeById.get(cid)
        if (child) result.push(child)
        else skip.push({ nodeId: cid, reason: 'node_disappeared' })
      }
    } else if (UNSUPPORTED_TYPES.has(node.type)) {
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
    } else if (SUPPORTED_TYPES.has(node.type)) {
      result.push(node)
    } else {
      // 未知 type 视为 unsupported（防漂移）
      skip.push({ nodeId: id, reason: 'unsupported_type', type: node.type })
    }
  }
  return result
}

// Find all nodes downstream of a given node by following edges
function getDownstreamNodes(
  nodeId: string,
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
): Set<string> {
  const downstream = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        downstream.add(edge.target)
        queue.push(edge.target)
      }
    }
  }
  return downstream
}

function kahnTopologicalSort(
  toRun: RawNode[],
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
): { run: string[]; blockedBy: PlanSelectionGenerateResult['blockedBy'] } {
  const runSet = new Set(toRun.map(n => n.id))
  const inDegree = new Map<string, number>(toRun.map(n => [n.id, 0]))
  const adj = new Map<string, string[]>(toRun.map(n => [n.id, []]))

  // 仅在选区内的边
  for (const e of edges) {
    if (runSet.has(e.source) && runSet.has(e.target)) {
      adj.get(e.source)!.push(e.target)
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
    }
  }

  // 稳定排序：按 id 字典序入队
  const ready = toRun.map(n => n.id).filter(id => (inDegree.get(id) ?? 0) === 0).sort()
  const run: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    run.push(id)
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) {
        // 插入到 sorted position
        const insertAt = ready.findIndex(r => r > next)
        if (insertAt < 0) ready.push(next)
        else ready.splice(insertAt, 0, next)
      }
    }
  }

  // 环：剩余 inDegree > 0 的节点
  const blockedBy: PlanSelectionGenerateResult['blockedBy'] = []
  const remaining = toRun.map(n => n.id).filter(id => (inDegree.get(id) ?? 0) > 0)
  for (const id of remaining) {
    run.push(id)
    // 记录环的边（任意 in 边即可）
    for (const e of edges) {
      if (runSet.has(e.source) && e.target === id) {
        blockedBy.push({ source: e.source, target: e.target, reason: 'cycle' })
        break
      }
    }
  }
  return { run, blockedBy }
}

export function planSelectionGenerate(input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  const skip: SkipReason[] = []
  const groupExpanded: PlanSelectionGenerateResult['groupExpanded'] = []
  const candidates = expandSelection(input.selectedIds, input.canvas.nodes, skip, groupExpanded)

  // pending_confirm 整批拒绝（SB-D3 / §4.3 #2）
  const pending = candidates.filter(n => String(n.data?.status ?? '') === 'pending_confirm')
  if (pending.length > 0) {
    throw new SelectionBatchPendingConfirmError(pending.length)
  }

  const toRun: RawNode[] = []
  for (const n of candidates) {
    const status = String(n.data?.status ?? '')
    if (status === 'fallback_pending') {
      skip.push({ nodeId: n.id, reason: 'fallback_pending' })
    } else if (input.hasUsableOutput(n) && !input.regenerate) {
      skip.push({ nodeId: n.id, reason: 'already_done' })
    } else if (input.isInFlight?.(n.id) === true) {
      skip.push({ nodeId: n.id, reason: 'in_flight' })
      // Mark all downstream nodes as upstream_in_flight
      const downstream = getDownstreamNodes(n.id, input.canvas.edges)
      for (const downstreamId of downstream) {
        skip.push({ nodeId: downstreamId, reason: 'upstream_in_flight', ref: n.id })
      }
    } else {
      toRun.push(n)
    }
  }

  // 24 上限（SB-D7 / §4.3 #6）
  if (toRun.length > 24) {
    throw new SelectionBatchLimitError(toRun.length)
  }

  // Remove downstream nodes that were already added to toRun (they should be skipped as upstream_in_flight)
  const inFlightDownstream = new Set<string>()
  for (const s of skip) {
    if (s.reason === 'upstream_in_flight') {
      inFlightDownstream.add(s.nodeId)
    }
  }
  const finalToRun = toRun.filter(n => !inFlightDownstream.has(n.id))

  const { run, blockedBy } = kahnTopologicalSort(finalToRun, input.canvas.edges)
  return { run, skip, blockedBy, groupExpanded }
}
