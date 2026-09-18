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
  hasUsableOutput: (node: { type: string; data?: Record<string, unknown> }) => boolean
  isInFlight?: (nodeId: string) => boolean
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

export function planSelectionGenerate(input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  const skip: SkipReason[] = []
  const groupExpanded: PlanSelectionGenerateResult['groupExpanded'] = []
  const candidates = expandSelection(input.selectedIds, input.canvas.nodes, skip, groupExpanded)
  // Task 5/6 会接 status filter + Kahn
  const run = candidates.filter(n => !input.hasUsableOutput(n)).map(n => n.id)
  for (const n of candidates) {
    if (input.hasUsableOutput(n)) {
      skip.push({ nodeId: n.id, reason: 'already_done' })
    }
  }
  return { run, skip, blockedBy: [], groupExpanded }
}
