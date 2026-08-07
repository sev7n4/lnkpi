import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatSessionTime, lastThreadStorageKey } from './formatSessionTime'

describe('formatSessionTime', () => {
  const now = new Date('2026-08-08T12:00:00.000Z').getTime()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty string for invalid ISO', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatSessionTime('not-a-date')).toBe('')
  })

  it('returns 刚刚 for less than one minute ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatSessionTime('2026-08-08T11:59:30.000Z')).toBe('刚刚')
  })

  it('returns minutes ago for under one hour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatSessionTime('2026-08-08T11:55:00.000Z')).toBe('5 分钟前')
  })

  it('returns hours ago for under one day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatSessionTime('2026-08-08T10:00:00.000Z')).toBe('2 小时前')
  })

  it('returns days ago for under 30 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatSessionTime('2026-08-05T12:00:00.000Z')).toBe('3 天前')
  })

  it('returns locale date string for 30+ days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const result = formatSessionTime('2026-06-01T12:00:00.000Z')
    expect(result).toBe(new Date('2026-06-01T12:00:00.000Z').toLocaleDateString())
  })
})

describe('lastThreadStorageKey', () => {
  it('returns session-scoped localStorage key', () => {
    expect(lastThreadStorageKey('sess-abc')).toBe('lnkpi:agentThread:sess-abc')
  })
})
