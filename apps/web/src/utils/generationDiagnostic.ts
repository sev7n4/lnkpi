import type { ErrorCode, GenerationDiagnostic, TaskKind } from '@lnkpi/shared'
import { formatDiagnosticCopy } from '@lnkpi/shared'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import {
  extractRefundedPointsFromError,
  extractStructuredGenerationFields,
  formatGenerationFailureMessage,
  parseRefundedPointsFromMetadata,
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

export function parseErrorCodeFromMetadata(metadata?: string | null): ErrorCode | undefined {
  if (!metadata) return undefined
  try {
    const meta = JSON.parse(metadata) as { errorCode?: unknown }
    return parseShortGenerationError({
      response: { data: { errorCode: meta.errorCode } },
    }).errorCode
  } catch {
    return undefined
  }
}

export function buildPollingFailurePatch(opts: {
  metadata?: string | null
  generationRecordId?: string
  materialId?: string
}): Record<string, unknown> {
  const refundedPoints = parseRefundedPointsFromMetadata(opts.metadata)
  const errorCode = parseErrorCodeFromMetadata(opts.metadata)
  const patch: Record<string, unknown> = {
    status: NODE_GENERATION_STATUS.error,
    errorMessage: refundedPoints
      ? formatGenerationFailureMessage(new Error('生成失败'), refundedPoints)
      : '生成失败',
  }
  if (opts.generationRecordId) patch.generationRecordId = opts.generationRecordId
  if (opts.materialId) patch.materialId = opts.materialId
  if (errorCode) patch.errorCode = errorCode
  return patch
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

      const promise = fetcher().catch((error) => {
        inflight.delete(key)
        throw error
      })
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
