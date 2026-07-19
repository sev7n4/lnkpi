import { describe, expect, it, vi } from 'vitest'
import { createFallbackConfirmQueue } from '@/composables/fallbackConfirmQueue'
import type { FallbackPendingRequest } from '@/composables/useNodeGeneration'

function makeReq(id = 'rec-1', kind: 'studio' | 'material' = 'studio'): FallbackPendingRequest {
  return { kind, id, nodeId: 'node-1', message: '请确认回退' }
}

describe('createFallbackConfirmQueue', () => {
  it('reuses the same Promise for the same key while dialog is open (no cancel race)', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const q = createFallbackConfirmQueue({
      defaultMessage: 'default',
      onOpen,
      onClose,
    })

    const p1 = q.request(makeReq())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(q.isPrompted('studio:rec-1')).toBe(true)

    const p2 = q.request(makeReq())
    expect(p2).toBe(p1)
    expect(onOpen).toHaveBeenCalledTimes(1)

    q.settle('confirm')
    await expect(p1).resolves.toBe('confirm')
    await expect(p2).resolves.toBe('confirm')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dedupes key already in queue behind an active prompt', async () => {
    const q = createFallbackConfirmQueue({
      defaultMessage: 'default',
      onOpen: vi.fn(),
      onClose: vi.fn(),
    })

    const first = q.request(makeReq('a'))
    const second = q.request(makeReq('b'))
    const secondAgain = q.request(makeReq('b'))
    expect(secondAgain).toBe(second)

    q.settle('confirm')
    await expect(first).resolves.toBe('confirm')

    q.settle('cancel')
    await expect(second).resolves.toBe('cancel')
    await expect(secondAgain).resolves.toBe('cancel')
  })

  it('returns cancel for a key already settled (anti-loop)', async () => {
    const q = createFallbackConfirmQueue({
      defaultMessage: 'default',
      onOpen: vi.fn(),
      onClose: vi.fn(),
    })

    const p = q.request(makeReq())
    q.settle('confirm')
    await expect(p).resolves.toBe('confirm')

    await expect(q.request(makeReq())).resolves.toBe('cancel')
  })
})
