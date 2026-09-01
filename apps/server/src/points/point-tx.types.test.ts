import { describe, expect, it } from 'vitest'
import { consumeMeta, refundMeta } from './point-tx.types'

describe('point transaction meta helpers', () => {
  it('builds consume metadata with explicit overrides', () => {
    expect(consumeMeta('image', { model: 'seedream', generationId: null })).toEqual({
      kind: 'consume',
      category: 'image',
      status: 'success',
      model: 'seedream',
      generationId: null,
    })
  })

  it('builds refund metadata with the requested status', () => {
    expect(refundMeta('video', 'cancelled_refund', { generationId: 'g1' })).toEqual({
      kind: 'refund',
      category: 'video',
      status: 'cancelled_refund',
      generationId: 'g1',
    })
  })
})
