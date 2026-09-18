/**
 * v3 spec §4 规划器
 * 纯函数；无副作用；不依赖 web/vue。
 */

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

// 占位实现（Task 4-6 逐步替换）
export function planSelectionGenerate(_input: PlanSelectionGenerateInput): PlanSelectionGenerateResult {
  return { run: [], skip: [], blockedBy: [], groupExpanded: [] }
}
