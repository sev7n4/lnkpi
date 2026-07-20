import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  resolveTaskChrome,
  truncateError,
} from './nodeTaskChrome'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

describe('nodeTaskChrome', () => {
  it('formats elapsed as m:ss', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    expect(formatElapsed(start, Date.parse('2026-07-20T00:00:42.000Z'))).toBe('0:42')
    expect(formatElapsed(start, Date.parse('2026-07-20T00:03:05.000Z'))).toBe('3:05')
    expect(formatElapsed(undefined, Date.now())).toBe('0:00')
  })

  it('generating shows spinner, cancel action, and elapsed', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    expect(
      resolveTaskChrome({
        status: NODE_GENERATION_STATUS.generating,
        startedAt: start,
        nowMs: Date.parse('2026-07-20T00:00:12.000Z'),
      }),
    ).toEqual({
      action: 'cancel',
      showSpinner: true,
      elapsedText: '0:12',
      tone: 'running',
    })
  })

  it('error and failed show retry action', () => {
    const expected = { action: 'retry' as const, showSpinner: false, elapsedText: null, tone: 'error' as const }
    expect(
      resolveTaskChrome({ status: NODE_GENERATION_STATUS.error, nowMs: Date.now() }),
    ).toEqual(expected)
    expect(
      resolveTaskChrome({ status: NODE_GENERATION_STATUS.failed, nowMs: Date.now() }),
    ).toEqual(expected)
  })

  it('fallback_pending shows pending tone without action', () => {
    expect(
      resolveTaskChrome({ status: NODE_GENERATION_STATUS.fallback_pending, nowMs: Date.now() }),
    ).toEqual({
      action: null,
      showSpinner: false,
      elapsedText: null,
      tone: 'pending',
    })
  })

  it('completed flashes success then hides', () => {
    expect(
      resolveTaskChrome({
        status: NODE_GENERATION_STATUS.completed,
        nowMs: Date.now(),
        completedFlash: true,
      }),
    ).toEqual({
      action: null,
      showSpinner: false,
      elapsedText: null,
      tone: 'success',
      flashSuccess: true,
    })
    expect(
      resolveTaskChrome({
        status: NODE_GENERATION_STATUS.completed,
        nowMs: Date.now(),
        completedFlash: false,
      }),
    ).toBeNull()
  })

  it('truncates error', () => {
    expect(truncateError('x'.repeat(50)).length).toBeLessThanOrEqual(40)
  })
})
