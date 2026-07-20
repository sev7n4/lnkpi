import { apiErrorMessage } from '@/utils/apiError'

export function extractRefundedPointsFromError(err: unknown): number | undefined {
  const ax = err as {
    response?: { data?: { refundedPoints?: unknown; data?: { refundedPoints?: unknown } } }
  }
  const raw = ax.response?.data?.refundedPoints ?? ax.response?.data?.data?.refundedPoints
  return typeof raw === 'number' && raw > 0 ? raw : undefined
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
