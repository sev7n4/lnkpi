import { describe, expect, it } from 'vitest'
import { buildHeatmapGrid, heatmapLevel, heatmapMonthLabels } from './usageHeatmapGrid'

describe('heatmapLevel', () => {
  it('maps 0 and empty max to level 0 and quarters to 1-4', () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(10, 0)).toBe(0)
    expect(heatmapLevel(25, 100)).toBe(1)
    expect(heatmapLevel(50, 100)).toBe(2)
    expect(heatmapLevel(75, 100)).toBe(3)
    expect(heatmapLevel(100, 100)).toBe(4)
  })
})

describe('buildHeatmapGrid', () => {
  it('pads from Monday of from-week to Sunday of to-week and marks out-of-range', () => {
    const grid = buildHeatmapGrid({
      from: '2026-09-16',
      to: '2026-09-16',
      days: [{ date: '2026-09-16', netConsumed: 80, generationCount: 2 }],
    })
    expect(grid).toHaveLength(7)
    const inRange = grid.flat().filter((c) => c.inRange)
    expect(inRange).toHaveLength(1)
    expect(inRange[0].date).toBe('2026-09-16')
    expect(inRange[0].level).toBe(4)
    expect(grid.flat().some((c) => !c.inRange)).toBe(true)
  })

  it('emits a month label on the first week and when the month changes', () => {
    const grid = buildHeatmapGrid({
      from: '2026-08-31',
      to: '2026-09-16',
      days: [],
    })
    const columns = grid[0].map((_, week) => grid.map((row) => row[week]))
    const labels = heatmapMonthLabels(columns)
    expect(labels[0]?.label).toMatch(/2026年8月|8月/)
    expect(labels.some((item) => item.label.includes('9月'))).toBe(true)
  })
})
