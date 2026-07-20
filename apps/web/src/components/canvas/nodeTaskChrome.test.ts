import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  resolveTaskBadge,
  resolveCornerAction,
  truncateError,
} from './nodeTaskChrome'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

describe('nodeTaskChrome', () => {
  it('formats elapsed as m:ss', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    expect(formatElapsed(start, Date.parse('2026-07-20T00:00:42.000Z'))).toBe('0:42')
    expect(formatElapsed(start, Date.parse('2026-07-20T00:03:05.000Z'))).toBe('3:05')
  })

  it('badge for generating includes elapsed', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    const b = resolveTaskBadge({
      status: NODE_GENERATION_STATUS.generating,
      startedAt: start,
      nowMs: Date.parse('2026-07-20T00:00:12.000Z'),
    })
    expect(b).toEqual({ text: '生成中 · 0:12', tone: 'running' })
  })

  it('corner cancel/retry mapping', () => {
    expect(resolveCornerAction(NODE_GENERATION_STATUS.generating)).toBe('cancel')
    expect(resolveCornerAction(NODE_GENERATION_STATUS.error)).toBe('retry')
    expect(resolveCornerAction(NODE_GENERATION_STATUS.fallback_pending)).toBeNull()
    expect(resolveCornerAction(NODE_GENERATION_STATUS.completed)).toBeNull()
  })

  it('truncates error', () => {
    expect(truncateError('x'.repeat(50)).length).toBeLessThanOrEqual(40)
  })
})
