import type { UsageHeatmapDay } from '@/services/users-api'

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

export interface HeatmapCell {
  date: string
  inRange: boolean
  netConsumed: number
  generationCount: number
  level: HeatmapLevel
}

export function heatmapLevel(net: number, max: number): HeatmapLevel {
  if (net <= 0 || max <= 0) return 0
  const ratio = net / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function mondayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 ? 6 : wd - 1
}

export function buildHeatmapGrid(input: {
  from: string
  to: string
  days: UsageHeatmapDay[]
}): HeatmapCell[][] {
  const byDate = new Map(input.days.map((day) => [day.date, day]))
  const max = Math.max(0, ...input.days.map((day) => day.netConsumed))
  const start = addDays(input.from, -mondayIndex(input.from))
  const end = addDays(input.to, 6 - mondayIndex(input.to))
  const columns: HeatmapCell[][] = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    const col: HeatmapCell[] = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i)
      const inRange = date >= input.from && date <= input.to
      const hit = byDate.get(date)
      col.push({
        date,
        inRange,
        netConsumed: inRange ? (hit?.netConsumed ?? 0) : 0,
        generationCount: inRange ? (hit?.generationCount ?? 0) : 0,
        level: inRange ? heatmapLevel(hit?.netConsumed ?? 0, max) : 0,
      })
    }
    columns.push(col)
  }
  return [0, 1, 2, 3, 4, 5, 6].map((row) => columns.map((col) => col[row]))
}
