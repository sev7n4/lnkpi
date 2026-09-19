import { describe, expect, it } from 'vitest'
import { formatTrendXLabel, trendPlot, trendXTickIndexes, trendYTicks } from './usageTrendAxis'

describe('trendYTicks', () => {
  it('returns 0, mid and max for larger series', () => {
    expect(trendYTicks(10)).toEqual([0, 5, 10])
    expect(trendYTicks(1)).toEqual([0, 1])
  })
})

describe('trendXTickIndexes', () => {
  it('labels every day for 7d, steps for 30d and month, always including last', () => {
    expect(trendXTickIndexes('7d', 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(trendXTickIndexes('30d', 30)).toEqual([0, 5, 10, 15, 20, 25, 29])
    expect(trendXTickIndexes('month', 16)).toEqual([0, 4, 8, 12, 15])
  })
})

describe('formatTrendXLabel', () => {
  it('formats as M/D', () => {
    expect(formatTrendXLabel('2026-09-16')).toBe('9/16')
    expect(formatTrendXLabel('2026-01-02')).toBe('1/2')
  })
})

describe('trendPlot', () => {
  it('reserves padding for axes', () => {
    expect(trendPlot.pad.l).toBeGreaterThan(30)
    expect(trendPlot.pad.b).toBeGreaterThan(20)
  })
})
