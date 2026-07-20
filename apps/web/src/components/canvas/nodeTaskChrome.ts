import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

export type TaskCornerAction = 'cancel' | 'retry' | null

export type TaskBadgeTone = 'running' | 'error' | 'success' | 'pending'

export type TaskChromeView = {
  action: TaskCornerAction
  showSpinner: boolean
  elapsedText: string | null
  tone: TaskBadgeTone
  flashSuccess?: boolean
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

/** Unified chrome view for circular corner controls + elapsed. */
export function resolveTaskChrome(input: {
  status: unknown
  startedAt?: string
  nowMs: number
  completedFlash?: boolean
}): TaskChromeView | null {
  const { status, startedAt, nowMs, completedFlash } = input

  if (status === NODE_GENERATION_STATUS.generating) {
    return {
      action: 'cancel',
      showSpinner: true,
      elapsedText: formatElapsed(startedAt, nowMs),
      tone: 'running',
    }
  }

  if (status === NODE_GENERATION_STATUS.error || status === NODE_GENERATION_STATUS.failed) {
    return {
      action: 'retry',
      showSpinner: false,
      elapsedText: null,
      tone: 'error',
    }
  }

  if (status === NODE_GENERATION_STATUS.fallback_pending) {
    return {
      action: null,
      showSpinner: false,
      elapsedText: null,
      tone: 'pending',
    }
  }

  if (status === NODE_GENERATION_STATUS.completed) {
    if (completedFlash) {
      return {
        action: null,
        showSpinner: false,
        elapsedText: null,
        tone: 'success',
        flashSuccess: true,
      }
    }
    return null
  }

  return null
}

/** Truncate error summary for card display (default ~40 chars). */
export function truncateError(message: string | undefined, max = 40): string {
  if (!message) return ''
  if (message.length <= max) return message
  return message.slice(0, max)
}
