/**
 * v3 spec §13.2 telemetry
 * V1 实现：console.debug（dev）+ stub（prod）
 * 后续接 analytics 平台只改这一处。
 */

export type BatchEvent =
  | { name: 'selection_batch_started'; payload: { sessionId: string; runCount: number; skipCount: number; total: number; triggerSource: string; flagOn: boolean; regenerate?: boolean } }
  | { name: 'selection_batch_node_settled'; payload: { sessionId: string; nodeId: string; kind: string; durationMs: number } }
  | { name: 'selection_batch_plan_rejected'; payload: { sessionId: string; reason: 'pending_confirm' | 'limit_24'; candidateCount: number; blockedCount: number } }
  | { name: 'selection_batch_completed'; payload: {
      sessionId: string
      total: number
      done: number
      failed: number
      cancelled: number
      timeout: number
      skipped: number
      durationMs: number
      creditCost: number
      pointsExhausted: boolean
      runCountAtStart: number
      abortReason: string
      regenerate?: boolean
    } }

export function reportBatchEvent(name: BatchEvent['name'], payload: BatchEvent['payload']): void {
  // dev 路径
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', name, payload)
  }
  // prod 路径：V1 dev-only stub — 无 prod channel
  return
}
