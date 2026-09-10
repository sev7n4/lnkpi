export interface PointsInsights {
  netConsumedTotal: number
  peakDayConsumed: number
  avgDailyConsumed: number
  activeDays: number
  longestStreakDays: number
}

const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export function shanghaiDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + SH_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function calendarDaysInclusive(from: Date, to: Date): number {
  const start = parseDayKey(shanghaiDayKey(from))
  const end = parseDayKey(shanghaiDayKey(to))
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, diff + 1)
}

export function computeLongestStreak(dayKeys: string[]): number {
  if (!dayKeys.length) return 0
  const sorted = [...new Set(dayKeys)].sort()
  let best = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDayKey(sorted[i - 1])
    const cur = parseDayKey(sorted[i])
    const gap = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
    if (gap === 1) {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 1
    }
  }
  return best
}

export function computePointsInsights(input: {
  netConsumedTotal: number
  consumeRows: Array<{ createdAt: Date; amount: number }>
  from: Date | null
  to: Date
}): PointsInsights {
  const { netConsumedTotal, consumeRows, to } = input
  if (!consumeRows.length) {
    return {
      netConsumedTotal,
      peakDayConsumed: 0,
      avgDailyConsumed: 0,
      activeDays: 0,
      longestStreakDays: 0,
    }
  }

  const dayTotals = new Map<string, number>()
  for (const row of consumeRows) {
    const key = shanghaiDayKey(row.createdAt)
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + Math.abs(row.amount))
  }

  const activeDayKeys = [...dayTotals.keys()].sort()
  const peakDayConsumed = Math.max(...[...dayTotals.values()])
  const effectiveFrom = input.from ?? parseDayKey(activeDayKeys[0])
  const windowDays = calendarDaysInclusive(effectiveFrom, to)

  return {
    netConsumedTotal,
    peakDayConsumed,
    avgDailyConsumed: netConsumedTotal / Math.max(1, windowDays),
    activeDays: activeDayKeys.length,
    longestStreakDays: computeLongestStreak(activeDayKeys),
  }
}
