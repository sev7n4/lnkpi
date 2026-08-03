import { onUnmounted, ref } from 'vue'
import { isStreamStale } from '@/components/agent/streamRecovery'

export interface UseAgentStreamOptions {
  /** Called once when SSE goes stale during an active stream. */
  onStale?: () => void
  /** How often to check staleness while streaming (ms). */
  pollMs?: number
}

/**
 * W12: Monitor an active agent SSE stream for heartbeat staleness.
 * Generation record polling stays independent (see useGenerationPolling).
 */
export function useAgentStream(options: UseAgentStreamOptions = {}) {
  const unreachable = ref(false)
  const lastActivityAt = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  let monitoring = false
  let staleNotified = false

  function touch() {
    lastActivityAt.value = Date.now()
    staleNotified = false
    if (unreachable.value) unreachable.value = false
  }

  function start() {
    stop()
    monitoring = true
    staleNotified = false
    unreachable.value = false
    lastActivityAt.value = Date.now()
    const pollMs = options.pollMs ?? 5000
    timer = setInterval(() => {
      if (!monitoring) return
      if (isStreamStale(lastActivityAt.value) && !staleNotified) {
        staleNotified = true
        unreachable.value = true
        options.onStale?.()
      }
    }, pollMs)
  }

  function stop() {
    monitoring = false
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function reset() {
    unreachable.value = false
    staleNotified = false
    lastActivityAt.value = Date.now()
  }

  onUnmounted(stop)

  return { unreachable, lastActivityAt, touch, start, stop, reset }
}

export const PHASE_LABELS: Record<string, string> = {
  intake: '理解需求',
  plan: '拟定方案',
  await_confirm: '等待方案确认',
  write_plan_node: '写入方案',
  split: '拆解画布',
  draft_copy: '起草文案',
  await_copy_confirm: '等待文案确认',
  write_copy_node: '写入文案',
  await_topo: '等待拓扑确认',
  await_atomic_confirm: '等待生成确认',
  atomic_parse: '解析原子需求',
  atomic_create: '创建画布节点',
  orchestrate_gen: '出图进行中',
  done: '已完成',
  error: '出错',
}

export function formatPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return '未知'
  return PHASE_LABELS[phase] ?? phase
}
