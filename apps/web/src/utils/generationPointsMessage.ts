import { apiErrorMessage } from '@/utils/apiError'

type ErrorResponseData = {
  refundedPoints?: unknown
  message?: unknown
  data?: { refundedPoints?: unknown }
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
