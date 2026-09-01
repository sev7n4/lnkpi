import { mapReasonToPointFields } from './reason-map'

export interface BackfillRow {
  amount: number
  reason: string
  kind: string
  category: string
  status: string | null
}

export interface BackfillFields {
  kind: string
  category: string
  status: string | null
}

const SPECIFIC_CATEGORIES = new Set(['text', 'image', 'audio', 'video'])

function kindMatchesAmount(kind: string, amount: number): boolean {
  if (amount < 0) return kind === 'consume'
  if (amount > 0) return kind === 'refund' || kind === 'grant'
  return true
}

export function resolveBackfillFields(row: BackfillRow): BackfillFields | null {
  const mapped = mapReasonToPointFields(row.reason, row.amount)
  let fields: BackfillFields = mapped

  // Runtime metadata can be more precise than the reason-only mapper. Preserve it
  // for platform-fallback-style rows unless the stored kind contradicts the sign.
  if (SPECIFIC_CATEGORIES.has(row.category) && mapped.category === 'other') {
    fields = kindMatchesAmount(row.kind, row.amount)
      ? { kind: row.kind, category: row.category, status: row.status }
      : { ...mapped, category: row.category }
  }

  if (
    fields.kind === row.kind &&
    fields.category === row.category &&
    fields.status === row.status
  ) {
    return null
  }
  return fields
}
