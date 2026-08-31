import type { PointCategory, PointKind, PointTxStatus } from './point-tx.types'

const CATEGORY_BY_LABEL: Array<{ match: RegExp; category: PointCategory }> = [
  { match: /文本生成|提示词模式生成/, category: 'text' },
  { match: /图像生成|图像变体|图像精修/, category: 'image' },
  { match: /视频生成/, category: 'video' },
  { match: /音频/, category: 'audio' },
]

function resolveCategory(reason: string): PointCategory {
  for (const { match, category } of CATEGORY_BY_LABEL) {
    if (match.test(reason)) return category
  }
  return 'other'
}

function isRefundReason(reason: string): boolean {
  return reason.includes('退款')
}

function parseRefundStatus(reason: string): PointTxStatus {
  if (reason.includes('-BYOK失败退款') || reason.includes('BYOK失败退款')) {
    return 'byok_refund'
  }
  if (reason.includes('-失败退款') || reason.includes('失败退款')) {
    return 'failed_refund'
  }
  if (reason.includes('-取消退款') || reason.includes('取消退款')) {
    return 'cancelled_refund'
  }
  return 'failed_refund'
}

export function mapReasonToPointFields(
  reason: string,
  amount: number,
): { kind: PointKind; category: PointCategory; status: PointTxStatus | null } {
  if (reason === '每日签到' || reason.startsWith('升级 ')) {
    return { kind: 'grant', category: 'other', status: null }
  }

  if (isRefundReason(reason)) {
    return {
      kind: 'refund',
      category: resolveCategory(reason),
      status: parseRefundStatus(reason),
    }
  }

  if (reason.includes('平台回退') || reason.startsWith('导演台批量生成')) {
    return { kind: 'consume', category: 'other', status: 'success' }
  }

  const category = resolveCategory(reason)
  if (category !== 'other') {
    return { kind: 'consume', category, status: 'success' }
  }

  if (amount < 0) {
    return { kind: 'consume', category: 'other', status: 'success' }
  }

  return { kind: 'grant', category: 'other', status: null }
}
