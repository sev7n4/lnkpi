import { describe, expect, it } from 'vitest'
import { resolvePointsRange } from './points-range'

const now = new Date('2026-09-15T08:00:00+08:00')

describe('resolvePointsRange', () => {
  it('month starts at Shanghai month start', () => {
    const { from, to } = resolvePointsRange('month', now)
    expect(from!.toISOString()).toBe(new Date('2026-09-01T00:00:00+08:00').toISOString())
    expect(to.toISOString()).toBe(now.toISOString())
  })

  it('7d is now minus 7 days', () => {
    const { from } = resolvePointsRange('7d', now)
    expect(from!.toISOString()).toBe(new Date('2026-09-08T08:00:00+08:00').toISOString())
  })

  it('all has null from', () => {
    expect(resolvePointsRange('all', now).from).toBeNull()
  })
})
