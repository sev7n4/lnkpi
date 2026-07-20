import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticCache, parseShortGenerationError } from './generationDiagnostic'

describe('parseShortGenerationError', () => {
  it('reads structured body', () => {
    const parsed = parseShortGenerationError({
      response: {
        data: {
          message: '上游超时',
          errorCode: 'upstream_timeout',
          taskKind: 'generation',
          taskId: 'g1',
        },
      },
    })
    expect(parsed).toMatchObject({
      userMessage: '上游超时',
      errorCode: 'upstream_timeout',
      taskId: 'g1',
    })
  })

  it('falls back to formatGenerationFailureMessage for legacy errors', () => {
    const parsed = parseShortGenerationError({
      response: { data: { message: '积分不足' } },
    })
    expect(parsed.userMessage).toBe('积分不足，请充值后再试')
    expect(parsed.errorCode).toBeUndefined()
  })

  it('reads refundedPoints from structured body', () => {
    const parsed = parseShortGenerationError({
      response: {
        data: {
          message: '已取消',
          refundedPoints: 8,
        },
      },
    })
    expect(parsed).toMatchObject({
      userMessage: '已取消，8 积分已返回',
      refundedPoints: 8,
    })
  })
})

describe('createDiagnosticCache', () => {
  it('dedupes in-flight fetches', async () => {
    const cache = createDiagnosticCache()
    const fetcher = vi.fn().mockResolvedValue({ taskId: 'g1', code: 'unknown' })
    const a = cache.get('generation', 'g1', fetcher)
    const b = cache.get('generation', 'g1', fetcher)
    await Promise.all([a, b])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('clears by taskId', async () => {
    const cache = createDiagnosticCache()
    const fetcher = vi.fn().mockResolvedValue({ taskId: 'g1', code: 'unknown' })
    await cache.get('generation', 'g1', fetcher)
    cache.clear('g1')
    await cache.get('generation', 'g1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
