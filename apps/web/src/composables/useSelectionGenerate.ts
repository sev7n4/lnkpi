/**
 * v3 spec §5 执行器
 * Vue composable；调度混合拓扑 + 硬超时 + 显式 cancel。
 */
import { ref, type Ref } from 'vue'
import type { EditableFlowNode } from './useSelectedNodeEditor'
import type { CanvasEdgeLike } from './useUpstreamNodeContext'
import type { PlanSelectionGenerateResult, SkipReason } from '@lnkpi/shared'
import { reportBatchEvent } from '@/utils/selectionBatchTelemetry'

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

export function useSelectionGenerate(deps: UseSelectionGenerateDeps) {
  const state = ref<BatchState>('idle')
  const progress = ref<BatchProgress>({
    done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
    abortReason: 'none',
  })

  // ---- 内部状态（per start 调用）----
  let inFlight = new Map<string, Promise<unknown>>()
  let waitingMap = new Map<string, string[]>()
  let queue: string[] = []
  let skippedMap = new Map<string, SkipReason>()
  let semaphore = SEMAPHORE
  let pointsExhausted = false
  let creditCost = 0
  let abortCtrl: AbortController
  let batchTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  let summaryDone = 0, summaryFailed = 0, summaryCancelled = 0, summaryTimeout = 0, summarySkipped = 0
  let summaryAbortReason: AbortReason = 'none'
  let batchSessionId = ''

  function findNode(id: string): EditableFlowNode | undefined {
    return deps.nodes.value.find(n => n.id === id)
  }

  function releaseDownstream(sourceId: string) {
    for (const [target, ds] of waitingMap) {
      const remaining = ds.filter(d => d !== sourceId)
      if (remaining.length === 0) {
        waitingMap.delete(target)
        if (!inFlight.has(target) && !skippedMap.has(target) && !queue.includes(target)) {
          queue.push(target)
        }
      } else {
        waitingMap.set(target, remaining)
      }
    }
  }

  function classifyError(err: unknown): SettleKind {
    const e = err as { code?: string; name?: string }
    if (e?.code === 'insufficient_points') return 'insufficient_points'
    if (e?.code === 'cancelled' || e?.name === 'AbortError') return 'cancelled'
    return 'failed'
  }

  function onNodeSettled(id: string, kind: SettleKind, durationMs: number) {
    inFlight.delete(id)
    semaphore++
    // telemetry 上报（Task 14 接入真实通道；这里先 console）
    // eslint-disable-next-line no-console
    console.debug('[sel-batch] node_settled', { id, kind, durationMs })
    reportBatchEvent('selection_batch_node_settled', {
      sessionId: batchSessionId, nodeId: id, kind, durationMs,
    })

    if (kind === 'ok') { progress.value.done++; summaryDone++; creditCost += 1 }
    else if (kind === 'failed' || kind === 'insufficient_points') {
      progress.value.failed++; summaryFailed++
      if (kind === 'insufficient_points') pointsExhausted = true
    }
    else if (kind === 'cancelled') { progress.value.cancelled++; summaryCancelled++ }
    else if (kind === 'timeout') { progress.value.timeout++; summaryTimeout++ }

    releaseDownstream(id)
  }

  async function runOneNode(id: string, node: EditableFlowNode): Promise<void> {
    const nodeStartTs = Date.now()
    let timerHandle: ReturnType<typeof setTimeout> | null = null
    try {
      const settlePromise = deps.generateForNode(node, { asRunGroupMember: true })
        .then(() => 'ok' as SettleKind)
        .catch(err => classifyError(err))
      const timeoutPromise = new Promise<SettleKind>(resolve => {
        timerHandle = setTimeout(() => resolve('timeout'), MAX_WAIT_PER_NODE_MS)
      })
      const kind = await Promise.race([settlePromise, timeoutPromise])
      onNodeSettled(id, kind, Date.now() - nodeStartTs)
    } finally {
      if (timerHandle) clearTimeout(timerHandle)
    }
  }

  function stop(): void {
    if (state.value !== 'running') return
    state.value = 'stopping'
    summaryAbortReason = 'user_stopped'
    progress.value.abortReason = 'user_stopped'
    abortCtrl.abort('user_stopped')
    for (const id of inFlight.keys()) deps.cancelGeneration(id)
  }

  async function start(plan: PlanSelectionGenerateResult): Promise<BatchSummary> {
    state.value = 'running'
    batchSessionId = crypto.randomUUID()
    abortCtrl = new AbortController()
    inFlight = new Map()
    waitingMap = new Map()
    queue = []
    skippedMap = new Map()
    semaphore = SEMAPHORE
    pointsExhausted = false
    creditCost = 0
    summaryDone = summaryFailed = summaryCancelled = summaryTimeout = summarySkipped = 0
    summaryAbortReason = 'none'
    progress.value = { done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: plan.run.length, abortReason: 'none' }
    const startTs = Date.now()

    // §13.2 telemetry: selection_batch_started
    reportBatchEvent('selection_batch_started', {
      sessionId: batchSessionId,
      runCount: plan.run.length,
      skipCount: plan.skip.length,
      total: plan.run.length + plan.skip.length,
      triggerSource: 'multi_select_toolbar',
      flagOn: true,
    })

    const runSet = new Set(plan.run)

    // 初始化：检查每个 run 节点 → queue / waiting / skip
    for (const id of plan.run) {
      const node = findNode(id)
      if (!node) {
        skippedMap.set(id, { nodeId: id, reason: 'node_disappeared' })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      if (deps.isInFlight(id)) {
        skippedMap.set(id, { nodeId: id, reason: 'in_flight' })
        progress.value.skipped++; summarySkipped++

        // Mark all in-selection downstream as upstream_in_flight
        const downstreamOfInFlight = new Set<string>()
        const stack = [id]
        while (stack.length > 0) {
          const current = stack.pop()!
          for (const e of deps.edges.value) {
            if (e.source === current && runSet.has(e.target) && !skippedMap.has(e.target)) {
              downstreamOfInFlight.add(e.target)
              stack.push(e.target)
            }
          }
        }
        for (const d of downstreamOfInFlight) {
          skippedMap.set(d, { nodeId: d, reason: 'upstream_in_flight', ref: id })
          progress.value.skipped++; summarySkipped++
        }

        releaseDownstream(id)
        continue
      }
      const upstreamIds = deps.resolveUpstreamIds(node)
      const upstreamInSel = upstreamIds.filter(uid => runSet.has(uid))
      const upstreamExt = upstreamIds.filter(uid => !runSet.has(uid))
      const inflightUp = upstreamExt.find(uid => deps.isInFlight(uid))
      if (inflightUp) {
        skippedMap.set(id, { nodeId: id, reason: 'upstream_in_flight', ref: inflightUp })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      const missing = upstreamExt.find(uid => {
        const n = findNode(uid)
        return !n || !deps.hasUsableOutput(n)
      })
      if (missing) {
        skippedMap.set(id, { nodeId: id, reason: 'missing_upstream', ref: missing })
        progress.value.skipped++; summarySkipped++
        releaseDownstream(id)
        continue
      }
      if (upstreamInSel.length === 0) {
        queue.push(id)
      } else {
        waitingMap.set(id, upstreamInSel)
      }
    }

    // 全批 30min timer
    batchTimeoutHandle = setTimeout(() => {
      if (state.value === 'done') return
      summaryAbortReason = 'batch_timeout'
      progress.value.abortReason = 'batch_timeout'
      abortCtrl.abort('batch_timeout')
      deps.toast('本批超过 30min 已自动停止', 'warn')
    }, MAX_BATCH_DURATION_MS)

    // 主 loop
    while (true) {
      if (abortCtrl.signal.aborted) {
        // §13.2 telemetry: plan rejected — only pending_confirm / limit_24 qualify
        const planRejectReason = (['pending_confirm', 'limit_24'] as const).includes(summaryAbortReason as 'pending_confirm' | 'limit_24')
          ? summaryAbortReason as 'pending_confirm' | 'limit_24'
          : null
        if (planRejectReason) {
          reportBatchEvent('selection_batch_plan_rejected', {
            sessionId: batchSessionId,
            reason: planRejectReason,
            candidateCount: plan.run.length,
            blockedCount: plan.blockedBy.length,
          })
        }
        for (const id of queue) {
          skippedMap.set(id, { nodeId: id, reason: 'user_stopped' })
          progress.value.skipped++; summarySkipped++
        }
        queue = []
        waitingMap.clear()
        for (const id of [...inFlight.keys()]) deps.cancelGeneration(id)
        break
      }
      if (queue.length === 0 && inFlight.size === 0) break

      while (semaphore > 0 && queue.length > 0) {
        const id = queue.shift()!
        const node = findNode(id)
        if (!node) {
          skippedMap.set(id, { nodeId: id, reason: 'node_disappeared' })
          progress.value.skipped++; summarySkipped++
          releaseDownstream(id)
          continue
        }
        inFlight.set(id, runOneNode(id, node))
        semaphore--
      }
      if (inFlight.size === 0) break
      await Promise.race([...inFlight.values()])
    }

    await Promise.allSettled([...inFlight.values()])
    if (batchTimeoutHandle) clearTimeout(batchTimeoutHandle)

    state.value = 'done'

    // 汇总 pointsExhausted → abortReason
    if (summaryAbortReason === 'none' && pointsExhausted) {
      summaryAbortReason = 'insufficient_points'
      progress.value.abortReason = 'insufficient_points'
    }

    // §13.2 telemetry: selection_batch_completed
    reportBatchEvent('selection_batch_completed', {
      sessionId: batchSessionId,
      total: plan.run.length + plan.skip.length,
      done: summaryDone,
      failed: summaryFailed,
      cancelled: summaryCancelled,
      timeout: summaryTimeout,
      skipped: summarySkipped,
      durationMs: Date.now() - startTs,
      creditCost,
      pointsExhausted,
      runCountAtStart: plan.run.length,
      abortReason: summaryAbortReason,
    })

    return {
      abortReason: summaryAbortReason,
      done: summaryDone, failed: summaryFailed, cancelled: summaryCancelled,
      timeout: summaryTimeout, skipped: summarySkipped,
      durationMs: Date.now() - startTs, creditCost,
    }
  }

  return { state, progress, start, stop }
}
