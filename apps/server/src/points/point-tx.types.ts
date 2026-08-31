export type PointKind = 'consume' | 'refund' | 'grant'

export type PointCategory = 'text' | 'image' | 'audio' | 'video' | 'other'

export type PointTxStatus = 'success' | 'failed_refund' | 'cancelled_refund' | 'byok_refund'

export interface PointTxMeta {
  kind: PointKind
  category: PointCategory
  status?: PointTxStatus | null
  model?: string | null
  generationId?: string | null
}

export function consumeMeta(
  category: PointCategory,
  extra: Partial<PointTxMeta> = {},
): PointTxMeta {
  return { kind: 'consume', category, status: 'success', ...extra }
}

export function refundMeta(
  category: PointCategory,
  status: PointTxStatus,
  extra: Partial<PointTxMeta> = {},
): PointTxMeta {
  return { kind: 'refund', category, status, ...extra }
}
