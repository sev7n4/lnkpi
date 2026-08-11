export type TaskItemStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'done'
  | 'failed'
  | 'needs_user'
  | 'skipped'

export interface AgentTaskItem {
  id: string
  title: string
  nodeId?: string
  kind?: string
  status: TaskItemStatus
  recordId?: string
  attempt?: number
  maxAttempts?: number
  errorHint?: string
  errorCode?: string
}

export interface AgentTaskProgressState {
  items: AgentTaskItem[]
  summary?: {
    success: number
    failed: number
    needsUser: number
    skipped: number
    lines?: Array<{ id: string; status: string; title: string; hint?: string }>
  }
  finished: boolean
  /** UX-PV-07: callout banner from runtime copy (product_visual gen). */
  banner?: string
}

export const emptyTaskProgress = (): AgentTaskProgressState => ({
  items: [],
  finished: false,
})

const TERMINAL_STATUSES: TaskItemStatus[] = ['done', 'failed', 'needs_user', 'skipped']

type TaskEvent =
  | { type: 'task_list'; data: { items: Array<{ id: string; title: string; nodeId?: string; kind?: string }>; banner?: string } }
  | {
      type: 'task_update'
      data: {
        id: string
        status: TaskItemStatus
        recordId?: string
        attempt?: number
        maxAttempts?: number
        errorHint?: string
        errorCode?: string
      }
    }
  | {
      type: 'task_summary'
      data: {
        success: number
        failed: number
        needsUser: number
        skipped: number
        lines?: Array<{ id: string; status: string; title: string; hint?: string }>
      }
    }

/** Map Studio generation record status → task card status (W11 authority channel). */
export function mapRecordStatusToTaskStatus(recordStatus: string): TaskItemStatus {
  const s = recordStatus.toLowerCase()
  if (s === 'completed' || s === 'success') return 'done'
  if (s === 'failed' || s === 'error' || s === 'timeout') return 'failed'
  if (s === 'fallback_pending') return 'needs_user'
  if (s === 'generating' || s === 'pending') return 'running'
  return 'running'
}

const TERMINAL_DONE: TaskItemStatus[] = ['done', 'skipped']

/** UX-PV-07: 「已完成 a/b · 正在生成：{title}」 */
export function formatTaskProgressLine(items: AgentTaskItem[]): string | null {
  if (!items.length) return null
  const total = items.length
  const done = items.filter((it) => TERMINAL_DONE.includes(it.status)).length
  const current =
    items.find((it) => it.status === 'running' || it.status === 'retrying') ??
    items.find((it) => it.status === 'pending')
  const currentTitle = current?.title ?? '…'
  return `已完成 ${done}/${total} · 正在生成：${currentTitle}`
}

export function applyTaskEvent(
  state: AgentTaskProgressState,
  event: TaskEvent,
): AgentTaskProgressState {
  if (event.type === 'task_list') {
    return {
      items: (event.data.items || []).map((it) => ({
        id: it.id,
        title: it.title,
        nodeId: it.nodeId,
        kind: it.kind,
        status: 'pending',
      })),
      finished: false,
      banner: event.data.banner,
    }
  }
  if (event.type === 'task_update') {
    const { recordId, status, ...rest } = event.data
    const items = state.items.map((it) => {
      if (it.id !== event.data.id) return it
      const next: AgentTaskItem = { ...it, ...rest }
      if (recordId) next.recordId = recordId
      // W11: SSE task_update is hint-only when recordId exists; terminal status from poll.
      const deferTerminal = Boolean(recordId || it.recordId) && TERMINAL_STATUSES.includes(status)
      if (!deferTerminal) {
        next.status = status
      } else if (status === 'running' || status === 'retrying' || status === 'pending') {
        next.status = status
      } else if (it.status === 'pending') {
        next.status = 'running'
      }
      return next
    })
    return { ...state, items }
  }
  if (event.type === 'task_summary') {
    return {
      ...state,
      summary: {
        success: event.data.success,
        failed: event.data.failed,
        needsUser: event.data.needsUser,
        skipped: event.data.skipped,
        lines: event.data.lines,
      },
      finished: true,
    }
  }
  return state
}

/** Apply polled generation record as authoritative task status (W11). */
export function applyPollRecordToTask(
  state: AgentTaskProgressState,
  nodeId: string,
  recordStatus: string,
): AgentTaskProgressState {
  const mapped = mapRecordStatusToTaskStatus(recordStatus)
  const items = state.items.map((it) =>
    it.nodeId === nodeId ? { ...it, status: mapped } : it,
  )
  return { ...state, items }
}
