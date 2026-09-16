import { describe, expect, it } from 'vitest'
import { parseUsageDaysRange, parseShanghaiDay } from '../points/points-usage-range'
import { parseLimit } from './membership.controller'

describe('parseLimit', () => {
  it('defaults to 50 when missing or invalid', () => {
    expect(parseLimit()).toBe(50)
    expect(parseLimit('')).toBe(50)
    expect(parseLimit('abc')).toBe(50)
    expect(parseLimit('NaN')).toBe(50)
    expect(parseLimit('0')).toBe(50)
    expect(parseLimit('-10')).toBe(50)
    expect(parseLimit('1.5')).toBe(50)
  })

  it('accepts positive integers and clamps to 100', () => {
    expect(parseLimit('1')).toBe(1)
    expect(parseLimit('50')).toBe(50)
    expect(parseLimit('100')).toBe(100)
    expect(parseLimit('101')).toBe(100)
    expect(parseLimit('9999')).toBe(100)
  })
})

describe('usage query parsers', () => {
  it('usage-days illegal range is 7d', () => {
    expect(parseUsageDaysRange('nope')).toBe('7d')
  })

  it('rejects invalid shanghai day', () => {
    expect(parseShanghaiDay('2026-02-31')).toBeNull()
  })
})
