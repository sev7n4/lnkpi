import { describe, expect, it } from 'vitest'
import {
  calendarDaysInclusive,
  computeLongestStreak,
  computePointsInsights,
  shanghaiDayKey,
} from './points-insights'

describe('shanghaiDayKey', () => {
  it('uses Asia/Shanghai calendar day', () => {
    // 2026-08-01 00:30 CST = 2026-07-31T16:30:00Z
    expect(shanghaiDayKey(new Date('2026-07-31T16:30:00.000Z'))).toBe('2026-08-01')
  })
})

describe('computeLongestStreak', () => {
  it('returns 0 for empty', () => {
    expect(computeLongestStreak([])).toBe(0)
  })

  it('counts consecutive calendar days', () => {
    expect(computeLongestStreak(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05'])).toBe(3)
  })
})

describe('computePointsInsights', () => {
  const to = new Date('2026-08-10T12:00:00.000Z')
  const from = new Date('2026-08-01T00:00:00.000Z')

  it('computes peak, active days, streak, and avg from consume rows', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 45,
      from,
      to,
      consumeRows: [
        { createdAt: new Date('2026-08-02T10:00:00.000Z'), amount: -20 },
        { createdAt: new Date('2026-08-02T08:00:00.000Z'), amount: -10 },
        { createdAt: new Date('2026-08-03T10:00:00.000Z'), amount: -15 },
      ],
    })
    expect(insights.netConsumedTotal).toBe(45)
    expect(insights.peakDayConsumed).toBe(30)
    expect(insights.activeDays).toBe(2)
    expect(insights.longestStreakDays).toBe(2)
    expect(insights.avgDailyConsumed).toBeCloseTo(45 / calendarDaysInclusive(from, to), 5)
  })

  it('returns zeros when no consume rows', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 0,
      from,
      to,
      consumeRows: [],
    })
    expect(insights).toEqual({
      netConsumedTotal: 0,
      peakDayConsumed: 0,
      avgDailyConsumed: 0,
      activeDays: 0,
      longestStreakDays: 0,
    })
  })

  it('uses from=null with earliest consume day for calendar span', () => {
    const insights = computePointsInsights({
      netConsumedTotal: 10,
      from: null,
      to: new Date('2026-08-09T15:00:00.000Z'),
      consumeRows: [{ createdAt: new Date('2026-08-09T10:00:00.000Z'), amount: -10 }],
    })
    expect(insights.activeDays).toBe(1)
    expect(insights.avgDailyConsumed).toBe(10)
  })
})
