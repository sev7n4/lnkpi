import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

export type TaskCornerAction = 'cancel' | 'retry' | null

export type TaskBadgeTone = 'running' | 'error' | 'success' | 'pending'

export type TaskBadge = {
  text: string
  tone: TaskBadgeTone
}

/** Elapsed time as m:ss. Missing/invalid startedAt → "0:00". */
export function formatElapsed(startedAt: string | undefined, nowMs: number): string {
  if (!startedAt) return '0:00'
  const startMs = Date.parse(startedAt)
  if (Number.isNaN(startMs)) return '0:00'
  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Title badge for Layout C. Status-driven (works for text/image/video/audio/shot).
 * completed only shows while completedFlash is true.
 */
export function resolveTaskBadge(input: {
  status: unknown
  startedAt?: string
  nowMs: number
  completedFlash?: boolean
}): TaskBadge | null {
  const { status, startedAt, nowMs, completedFlash } = input

  if (status === NODE_GENERATION_STATUS.generating) {
    return {
      text: `生成中 · ${formatElapsed(startedAt, nowMs)}`,
      tone: 'running',
    }
  }

  if (status === NODE_GENERATION_STATUS.error || status === NODE_GENERATION_STATUS.failed) {
    return { text: '失败', tone: 'error' }
  }

  if (status === NODE_GENERATION_STATUS.fallback_pending) {
    return { text: '待确认', tone: 'pending' }
  }

  if (status === NODE_GENERATION_STATUS.completed) {
    if (completedFlash) return { text: '已完成', tone: 'success' }
    return null
  }

  return null
}

/** Corner action: cancel while generating, retry on error/failed. */
export function resolveCornerAction(status: unknown): TaskCornerAction {
  if (status === NODE_GENERATION_STATUS.generating) return 'cancel'
  if (status === NODE_GENERATION_STATUS.error || status === NODE_GENERATION_STATUS.failed) {
    return 'retry'
  }
  return null
}

/** Truncate error summary for card display (default ~40 chars). */
export function truncateError(message: string | undefined, max = 40): string {
  if (!message) return ''
  if (message.length <= max) return message
  return message.slice(0, max)
}
