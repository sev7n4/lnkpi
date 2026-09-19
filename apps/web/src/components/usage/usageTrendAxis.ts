export const trendPlot = {
  width: 640,
  height: 200,
  pad: { l: 44, r: 12, t: 10, b: 28 },
} as const

export type TrendRangeKey = '7d' | '30d' | 'month'

export function trendYTicks(max: number): number[] {
  const peak = Math.max(0, max)
  if (peak < 2) return [0, peak]
  const mid = Math.round(peak / 2)
  return [0, mid, peak]
}

export function trendXTickIndexes(range: TrendRangeKey, n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [0]
  const step = range === '7d' ? 1 : range === '30d' ? 5 : 4
  const indexes: number[] = []
  for (let i = 0; i < n; i += step) indexes.push(i)
  const last = n - 1
  if (indexes[indexes.length - 1] !== last) indexes.push(last)
  return indexes
}

export function formatTrendXLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  return `${Number(match[2])}/${Number(match[3])}`
}

export function trendPoint(index: number, n: number, value: number, max: number) {
  const { width, height, pad } = trendPlot
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const x = n <= 1 ? pad.l + plotW / 2 : pad.l + (index / (n - 1)) * plotW
  const peak = Math.max(1, max)
  const y = pad.t + plotH - (value / peak) * plotH
  return { x, y }
}
