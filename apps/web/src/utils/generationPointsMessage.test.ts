import { describe, expect, it } from 'vitest'
import {
  extractRefundedPointsFromError,
  formatCancelledMessage,
  formatGenerationFailureMessage,
} from '@/utils/generationPointsMessage'

function axiosLikeError(message: string, extra?: Record<string, unknown>) {
  return {
    response: {
      data: {
        message,
        ...extra,
      },
    },
  }
}

describe('formatGenerationFailureMessage', () => {
  it('maps 积分不足 to recharge prompt', () => {
    expect(formatGenerationFailureMessage(axiosLikeError('积分不足'))).toBe('积分不足，请充值后再试')
  })

  it('maps failure with refundedPoints', () => {
    expect(formatGenerationFailureMessage(new Error('upstream failed'), 10)).toBe(
      '生成失败，10 积分已返回',
    )
  })

  it('maps 已取消 without refund amount', () => {
    expect(formatGenerationFailureMessage(axiosLikeError('已取消'))).toBe('已取消')
  })

  it('maps 已取消 with refundedPoints', () => {
    expect(formatGenerationFailureMessage(axiosLikeError('已取消'), 5)).toBe('已取消，5 积分已返回')
  })

  it('normalizes generic axios 400 message', () => {
    expect(formatGenerationFailureMessage(new Error('Request failed with status code 400'))).toBe(
      '生成失败',
    )
  })

  it('passes through other server messages', () => {
    expect(formatGenerationFailureMessage(axiosLikeError('模型不可用'))).toBe('模型不可用')
  })
})

describe('formatCancelledMessage', () => {
  it('returns plain cancel when no refund', () => {
    expect(formatCancelledMessage()).toBe('已取消')
    expect(formatCancelledMessage(0)).toBe('已取消')
  })

  it('includes refunded points when positive', () => {
    expect(formatCancelledMessage(8)).toBe('已取消，8 积分已返回')
  })
})

describe('extractRefundedPointsFromError', () => {
  it('reads refundedPoints from response data', () => {
    expect(extractRefundedPointsFromError(axiosLikeError('已取消', { refundedPoints: 12 }))).toBe(12)
  })

  it('reads nested refundedPoints', () => {
    expect(
      extractRefundedPointsFromError({
        response: { data: { data: { refundedPoints: 6 } } },
      }),
    ).toBe(6)
  })

  it('reads refundedPoints from Nest object message', () => {
    expect(
      extractRefundedPointsFromError({
        response: { data: { message: { message: '已取消', refundedPoints: 8 } } },
      }),
    ).toBe(8)
  })

  it('returns undefined when missing or non-positive', () => {
    expect(extractRefundedPointsFromError(new Error('canceled'))).toBeUndefined()
    expect(extractRefundedPointsFromError(axiosLikeError('fail', { refundedPoints: 0 }))).toBeUndefined()
  })
})
