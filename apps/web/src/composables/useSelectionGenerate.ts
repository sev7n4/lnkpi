/**
 * v3 spec §5 执行器
 * Vue composable；调度混合拓扑 + 硬超时 + 显式 cancel。
 */
import { ref, type Ref } from 'vue'
import type { EditableFlowNode } from './useSelectedNodeEditor'
import type { CanvasEdgeLike } from './useNodeGeneration'
import type { PlanSelectionGenerateResult, SkipReason } from '@lnkpi/shared'

export type SettleKind =
  | 'ok' | 'failed' | 'insufficient_points' | 'cancelled' | 'timeout'
  | 'in_flight' | 'upstream_in_flight' | 'node_disappeared'
  | 'missing_upstream' | 'unsupported_type' | 'fallback_pending'
  | 'already_done' | 'user_stopped'

export type AbortReason =
  | 'none' | 'pending_confirm' | 'limit_24' | 'user_stopped'
  | 'insufficient_points' | 'batch_timeout' | 'node_timeout'

export interface BatchProgress {
  done: number
  failed: number
  cancelled: number
  timeout: number
  skipped: number
  total: number
  abortReason: AbortReason
}

export interface BatchSummary {
  abortReason: AbortReason
  done: number; failed: number; cancelled: number; timeout: number; skipped: number
  durationMs: number
  creditCost: number
}

export type BatchState = 'idle' | 'running' | 'stopping' | 'done'

export interface UseSelectionGenerateDeps {
  nodes: Ref<EditableFlowNode[]>
  edges: Ref<CanvasEdgeLike[]>
  generateForNode: (node: EditableFlowNode, opts: { asRunGroupMember: true }) => Promise<void>
  hasUsableOutput: (node: EditableFlowNode) => boolean
  resolveUpstreamIds: (node: EditableFlowNode) => string[]
  cancelGeneration: (nodeId: string) => void
  isInFlight: (nodeId: string) => boolean
  toast: (msg: string, kind?: 'info' | 'warn' | 'error') => void
}

export const MAX_WAIT_PER_NODE_MS = 600_000
export const MAX_BATCH_DURATION_MS = 1_800_000
export const SEMAPHORE = 3

export function useSelectionGenerate(_deps: UseSelectionGenerateDeps) {
  const state = ref<BatchState>('idle')
  const progress = ref<BatchProgress>({
    done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
    abortReason: 'none',
  })

  async function start(_plan: PlanSelectionGenerateResult): Promise<BatchSummary> {
    // Task 8-11 填充
    state.value = 'done'
    return {
      abortReason: 'none', done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0,
      durationMs: 0, creditCost: 0,
    }
  }

  function stop(): void {
    // Task 11 填充
  }

  return { state, progress, start, stop }
}
