import type { ErrorCode, TaskKind } from '@lnkpi/shared'
import { apiErrorMessage } from '@/utils/apiError'

type ErrorResponseData = {
  refundedPoints?: unknown
  message?: unknown
  errorCode?: unknown
  taskKind?: unknown
  taskId?: unknown
  data?: { refundedPoints?: unknown }
}

const ERROR_CODES = new Set<string>([
  'insufficient_points',
  'upstream_timeout',
  'upstream_error',
  'cancelled',
  'invalid_input',
  'model_unavailable',
  'upload_required',
  'fallback_pending',
  'unknown',
])

const TASK_KINDS = new Set<string>(['generation', 'material'])

function readStringField(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function readErrorCode(raw: unknown): ErrorCode | undefined {
  return typeof raw === 'string' && ERROR_CODES.has(raw) ? (raw as ErrorCode) : undefined
}

function readTaskKind(raw: unknown): TaskKind | undefined {
  return typeof raw === 'string' && TASK_KINDS.has(raw) ? (raw as TaskKind) : undefined
}

export function extractStructuredGenerationFields(err: unknown): {
  userMessage?: string
  errorCode?: ErrorCode
  taskKind?: TaskKind
  taskId?: string
  refundedPoints?: number
} {
  const data = (err as { response?: { data?: ErrorResponseData } }).response?.data
  if (!data) return {}

  const message = data.message
  const userMessage =
    typeof message === 'string'
      ? message
      : message && typeof message === 'object' && message !== null
        ? readStringField((message as { message?: unknown }).message)
        : undefined

  return {
    userMessage,
    errorCode: readErrorCode(data.errorCode),
    taskKind: readTaskKind(data.taskKind),
    taskId: readStringField(data.taskId),
    refundedPoints: readRefundedPointsFromData(data),
  }
}

function readPositiveRefundedPoints(raw: unknown): number | undefined {
  return typeof raw === 'number' && raw > 0 ? raw : undefined
}

function readRefundedPointsFromData(data?: ErrorResponseData): number | undefined {
  if (!data) return undefined
  const message = data.message
  const fromMessage =
    message && typeof message === 'object' && message !== null
      ? readPositiveRefundedPoints((message as { refundedPoints?: unknown }).refundedPoints)
      : undefined
  return (
    readPositiveRefundedPoints(data.refundedPoints) ??
    fromMessage ??
    readPositiveRefundedPoints(data.data?.refundedPoints)
  )
}

export function extractRefundedPointsFromError(err: unknown): number | undefined {
  const ax = err as { response?: { data?: ErrorResponseData } }
  return readRefundedPointsFromData(ax.response?.data)
}

export function parseRefundedPointsFromMetadata(metadata?: string | null): number | undefined {
  if (!metadata) return undefined
  try {
    const meta = JSON.parse(metadata) as { refundedPoints?: unknown }
    return readPositiveRefundedPoints(meta.refundedPoints)
  } catch {
    return undefined
  }
}

export function formatCancelledMessage(refundedPoints?: number): string {
  return refundedPoints && refundedPoints > 0
    ? `已取消，${refundedPoints} 积分已返回`
    : '已取消'
}

export function formatGenerationFailureMessage(err: unknown, refundedPoints?: number): string {
  const raw = apiErrorMessage(err, '生成失败')
  if (raw.includes('积分不足')) return '积分不足，请充值后再试'
  if (raw.includes('已取消')) {
    return refundedPoints && refundedPoints > 0
      ? `已取消，${refundedPoints} 积分已返回`
      : '已取消'
  }
  if (refundedPoints && refundedPoints > 0) {
    return `生成失败，${refundedPoints} 积分已返回`
  }
  return raw === 'Request failed with status code 400' ? '生成失败' : raw
}
