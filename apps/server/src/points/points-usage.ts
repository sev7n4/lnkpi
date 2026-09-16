export interface UsageCategoryBreakdown {
  text: number
  image: number
  audio: number
  video: number
}

export interface UsageDayPoint {
  date: string
  generationCount: number
  netConsumed: number
  byCategory: UsageCategoryBreakdown
  otherNetConsumed: number
}

export interface UsageOverview {
  netConsumedTotal: number
  byCategory: UsageCategoryBreakdown
  otherNetConsumed: number
  generationCount: number
  activeDays: number
}

export interface UsageHeatmapDay {
  date: string
  netConsumed: number
  generationCount: number
}

export interface UsageOverviewResponse {
  overview: UsageOverview
  heatmap: {
    from: string
    to: string
    activeDays: number
    days: UsageHeatmapDay[]
  }
}

export interface UsageDaysResponse {
  range: '7d' | '30d' | 'month'
  from: string
  to: string
  days: UsageDayPoint[]
}

export interface DailyAmountRow {
  day: string
  kind: string
  category: string
  amountSum: number
}

export interface DailyGenerationRow {
  day: string
  distinctGens: number
  nullGens: number
}

const EMPTY_CATEGORY: UsageCategoryBreakdown = { text: 0, image: 0, audio: 0, video: 0 }

function emptyDay(date: string): UsageDayPoint {
  return {
    date,
    generationCount: 0,
    netConsumed: 0,
    byCategory: { ...EMPTY_CATEGORY },
    otherNetConsumed: 0,
  }
}

export function netFromKindCategorySums(
  rows: Array<{ kind: string; category: string; amountSum: number }>,
): { byCategory: UsageCategoryBreakdown; otherNetConsumed: number; netConsumedTotal: number } {
  const consumed = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
  const refunded = { text: 0, image: 0, audio: 0, video: 0, other: 0 }
  for (const row of rows) {
    const category = row.category in consumed ? (row.category as keyof typeof consumed) : 'other'
    if (row.kind === 'consume') consumed[category] += row.amountSum
    if (row.kind === 'refund') refunded[category] += row.amountSum
  }
  const net = (key: keyof typeof consumed) => Math.max(0, -consumed[key] - refunded[key])
  const byCategory = {
    text: net('text'),
    image: net('image'),
    audio: net('audio'),
    video: net('video'),
  }
  const otherNetConsumed = net('other')
  return {
    byCategory,
    otherNetConsumed,
    netConsumedTotal: byCategory.text + byCategory.image + byCategory.audio + byCategory.video + otherNetConsumed,
  }
}

export function generationCountFromParts(parts: { distinctGens: number; nullGens: number }): number {
  return Math.max(0, parts.distinctGens) + Math.max(0, parts.nullGens)
}

function nextDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function foldDailyUsage(
  amountRows: DailyAmountRow[],
  generationRows: DailyGenerationRow[],
): UsageDayPoint[] {
  const byDay = new Map<string, DailyAmountRow[]>()
  for (const row of amountRows) {
    const list = byDay.get(row.day) ?? []
    list.push(row)
    byDay.set(row.day, list)
  }
  const gens = new Map(generationRows.map((row) => [row.day, row]))
  const days = new Set([...byDay.keys(), ...gens.keys()])
  return [...days]
    .sort()
    .map((date) => {
      const net = netFromKindCategorySums(byDay.get(date) ?? [])
      const gen = gens.get(date)
      return {
        date,
        generationCount: gen ? generationCountFromParts(gen) : 0,
        netConsumed: net.netConsumedTotal,
        byCategory: net.byCategory,
        otherNetConsumed: net.otherNetConsumed,
      }
    })
}

export function fillCalendarDays(fromKey: string, toKey: string, days: UsageDayPoint[]): UsageDayPoint[] {
  const map = new Map(days.map((day) => [day.date, day]))
  const filled: UsageDayPoint[] = []
  for (let key = fromKey; key <= toKey; key = nextDateKey(key)) {
    filled.push(map.get(key) ?? emptyDay(key))
  }
  return filled
}

export function filterHeatmapDays(days: UsageDayPoint[]): UsageHeatmapDay[] {
  return days
    .filter((day) => day.netConsumed > 0 || day.generationCount > 0)
    .map((day) => ({
      date: day.date,
      netConsumed: day.netConsumed,
      generationCount: day.generationCount,
    }))
}
