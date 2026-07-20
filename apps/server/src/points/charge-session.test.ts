import { describe, expect, it } from 'vitest'
import { alreadyRefunded, applyChargeMeta, applyRefundMeta } from './charge-session'

describe('charge-session', () => {
  it('applyChargeMeta adds chargedPoints to meta', () => {
    expect(applyChargeMeta({ foo: 'bar' }, 10)).toEqual({ foo: 'bar', chargedPoints: 10 })
  })

  it('applyRefundMeta adds refundedPoints and refundReason to meta', () => {
    expect(applyRefundMeta({ chargedPoints: 10 }, 10, '文本生成退款')).toEqual({
      chargedPoints: 10,
      refundedPoints: 10,
      refundReason: '文本生成退款',
    })
  })

  it('alreadyRefunded returns true when refundedPoints > 0', () => {
    expect(alreadyRefunded({ refundedPoints: 5 })).toBe(true)
  })

  it('alreadyRefunded returns false when refundedPoints is missing or not positive', () => {
    expect(alreadyRefunded({})).toBe(false)
    expect(alreadyRefunded({ refundedPoints: 0 })).toBe(false)
    expect(alreadyRefunded({ refundedPoints: '5' })).toBe(false)
  })
})
