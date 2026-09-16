import { describe, expect, it } from 'vitest'
import {
  addShanghaiCalendarMonths,
  parseShanghaiDay,
  parseUsageDaysRange,
  resolveHeatmapRange,
  resolveUsageDaysRange,
} from './points-usage-range'

describe('parseUsageDaysRange', () => {
  it('accepts 7d, 30d, month and falls back to 7d', () => {
    expect(parseUsageDaysRange('7d')).toBe('7d')
    expect(parseUsageDaysRange('30d')).toBe('30d')
    expect(parseUsageDaysRange('month')).toBe('month')
    expect(parseUsageDaysRange('all')).toBe('7d')
    expect(parseUsageDaysRange()).toBe('7d')
  })
})

describe('resolveUsageDaysRange', () => {
  it('uses 7 Shanghai calendar days including today, not 168 hours', () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    const r = resolveUsageDaysRange('7d', now)
    expect(r.fromKey).toBe('2026-09-10')
    expect(r.toKey).toBe('2026-09-16')
    expect(r.from.toISOString()).toBe('2026-09-09T16:00:00.000Z')
  })

  it('uses 30 Shanghai calendar days including today', () => {
    const r = resolveUsageDaysRange('30d', new Date('2026-09-16T12:00:00.000Z'))
    expect(r.fromKey).toBe('2026-08-18')
    expect(r.toKey).toBe('2026-09-16')
  })

  it('month is Shanghai 1st 00:00 through now', () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    const r = resolveUsageDaysRange('month', now)
    expect(r.fromKey).toBe('2026-09-01')
    expect(r.toKey).toBe('2026-09-16')
    expect(r.from.toISOString()).toBe('2026-08-31T16:00:00.000Z')
    expect(r.to).toBe(now)
  })
})

describe('resolveHeatmapRange', () => {
  it('subtracts 6 calendar months including today', () => {
    const r = resolveHeatmapRange(new Date('2026-09-16T12:00:00.000Z'))
    expect(r.fromKey).toBe('2026-03-16')
    expect(r.toKey).toBe('2026-09-16')
  })

  it('clamps overflow day to last day of target month', () => {
    expect(addShanghaiCalendarMonths('2026-03-31', -6)).toBe('2025-09-30')
    const r = resolveHeatmapRange(new Date('2026-03-31T04:00:00.000Z'))
    expect(r.fromKey).toBe('2025-09-30')
    expect(r.toKey).toBe('2026-03-31')
  })
})

describe('parseShanghaiDay', () => {
  it('returns [00:00, next 00:00) in Shanghai', () => {
    const d = parseShanghaiDay('2026-09-16')
    expect(d?.from.toISOString()).toBe('2026-09-15T16:00:00.000Z')
    expect(d?.next.toISOString()).toBe('2026-09-16T16:00:00.000Z')
  })

  it('rejects malformed and impossible days', () => {
    expect(parseShanghaiDay('2026-9-16')).toBeNull()
    expect(parseShanghaiDay('2026-02-31')).toBeNull()
    expect(parseShanghaiDay('')).toBeNull()
  })
})
