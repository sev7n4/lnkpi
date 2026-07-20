import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  alreadyRefunded,
  applyChargeMeta,
  applyRefundMeta,
  isCancelledException,
  rethrowWithRefundedPoints,
  throwCancelledException,
} from './charge-session'

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

  it('throwCancelledException includes refundedPoints in response body', () => {
    try {
      throwCancelledException(10)
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException)
      expect((err as BadRequestException).getResponse()).toMatchObject({
        message: '已取消',
        refundedPoints: 10,
      })
      expect(isCancelledException(err)).toBe(true)
    }
  })

  it('rethrowWithRefundedPoints attaches refundedPoints to existing BadRequestException', () => {
    try {
      rethrowWithRefundedPoints(new BadRequestException('upstream failed'), 10)
      expect.fail('should throw')
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        message: 'upstream failed',
        refundedPoints: 10,
      })
    }
  })
})
