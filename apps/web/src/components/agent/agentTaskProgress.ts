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
  attempt?: number
  maxAttempts?: number
  errorHint?: string
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
}

export const emptyTaskProgress = (): AgentTaskProgressState => ({
  items: [],
  finished: false,
})

type TaskEvent =
  | { type: 'task_list'; data: { items: Array<{ id: string; title: string; nodeId?: string; kind?: string }> } }
  | {
      type: 'task_update'
      data: {
        id: string
        status: TaskItemStatus
        attempt?: number
        maxAttempts?: number
        errorHint?: string
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
    }
  }
  if (event.type === 'task_update') {
    const items = state.items.map((it) =>
      it.id === event.data.id
        ? {
            ...it,
            status: event.data.status,
            attempt: event.data.attempt,
            maxAttempts: event.data.maxAttempts,
            errorHint: event.data.errorHint,
          }
        : it,
    )
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
