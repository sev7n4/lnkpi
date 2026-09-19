import { shanghaiDayKey } from './points-insights'

export type UsageDaysRangeKey = '7d' | '30d' | 'month' | 'all'

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export function parseUsageDaysRange(raw?: string): UsageDaysRangeKey {
  return raw === '30d' || raw === 'month' || raw === 'all' ? raw : '7d'
}

export function shanghaiMidnight(y: number, month0: number, day: number): Date {
  return new Date(Date.UTC(y, month0, day, 0, 0, 0) - SH_OFFSET_MS)
}

function shanghaiParts(d: Date) {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  }
}

function lastDayOfMonth(y: number, month0: number): number {
  return new Date(Date.UTC(y, month0 + 1, 0)).getUTCDate()
}

export function addShanghaiCalendarMonths(fromKey: string, deltaMonths: number): string {
  const [ys, ms, ds] = fromKey.split('-').map(Number)
  const idx = ys * 12 + (ms - 1) + deltaMonths
  const y = Math.floor(idx / 12)
  const m0 = ((idx % 12) + 12) % 12
  const day = Math.min(ds, lastDayOfMonth(y, m0))
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function resolveUsageDaysRange(
  range: UsageDaysRangeKey,
  now = new Date(),
): { from: Date; to: Date; fromKey: string; toKey: string } {
  const toKey = shanghaiDayKey(now)
  if (range === 'all') {
    const from = new Date(0)
    return { from, to: now, fromKey: shanghaiDayKey(from), toKey }
  }
  const { y, m, day } = shanghaiParts(now)
  if (range === 'month') {
    const from = shanghaiMidnight(y, m, 1)
    return { from, to: now, fromKey: shanghaiDayKey(from), toKey }
  }
  const back = range === '7d' ? 6 : 29
  const from = shanghaiMidnight(y, m, day - back)
  return { from, to: now, fromKey: shanghaiDayKey(from), toKey }
}

export function resolveHeatmapRange(now = new Date()): {
  from: Date
  to: Date
  fromKey: string
  toKey: string
} {
  const toKey = shanghaiDayKey(now)
  const fromKey = addShanghaiCalendarMonths(toKey, -6)
  const [y, m, d] = fromKey.split('-').map(Number)
  return { from: shanghaiMidnight(y, m - 1, d), to: now, fromKey, toKey }
}

export function parseShanghaiDay(raw: string): { from: Date; next: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const from = shanghaiMidnight(y, m - 1, d)
  if (shanghaiDayKey(from) !== raw) return null
  return { from, next: shanghaiMidnight(y, m - 1, d + 1) }
}
