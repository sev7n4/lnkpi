import type { ErrorCode, GenerationDiagnostic, TaskKind } from '@lnkpi/shared'
import { formatDiagnosticCopy } from '@lnkpi/shared'
import {
  extractRefundedPointsFromError,
  extractStructuredGenerationFields,
  formatGenerationFailureMessage,
} from '@/utils/generationPointsMessage'

export type { ErrorCode, GenerationDiagnostic, TaskKind }
export { formatDiagnosticCopy }

export interface ShortGenerationError {
  userMessage: string
  errorCode?: ErrorCode
  taskKind?: TaskKind
  taskId?: string
  refundedPoints?: number
}

export function parseShortGenerationError(err: unknown): ShortGenerationError {
  const structured = extractStructuredGenerationFields(err)
  const refundedPoints =
    structured.refundedPoints ?? extractRefundedPointsFromError(err)
  const errForFormat = structured.userMessage
    ? { response: { data: { message: structured.userMessage } } }
    : err
  const userMessage = formatGenerationFailureMessage(errForFormat, refundedPoints)

  return {
    userMessage,
    errorCode: structured.errorCode,
    taskKind: structured.taskKind,
    taskId: structured.taskId,
    refundedPoints,
  }
}

export interface DiagnosticCache {
  get(
    taskKind: TaskKind,
    taskId: string,
    fetcher: () => Promise<GenerationDiagnostic>,
  ): Promise<GenerationDiagnostic>
  clear(taskId?: string): void
}

export function createDiagnosticCache(): DiagnosticCache {
  const inflight = new Map<string, Promise<GenerationDiagnostic>>()

  return {
    get(taskKind, taskId, fetcher) {
      const key = `${taskKind}:${taskId}`
      const existing = inflight.get(key)
      if (existing) return existing

      const promise = fetcher()
      inflight.set(key, promise)
      return promise
    },
    clear(taskId) {
      if (taskId === undefined) {
        inflight.clear()
        return
      }
      for (const key of inflight.keys()) {
        if (key.endsWith(`:${taskId}`)) {
          inflight.delete(key)
        }
      }
    },
  }
}
