import { describe, expect, it, vi } from 'vitest'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import {
  buildCopyForNode,
  buildPollingFailurePatch,
  createDiagnosticCache,
  parseErrorCodeFromMetadata,
  parseShortGenerationError,
} from './generationDiagnostic'

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

describe('parseErrorCodeFromMetadata', () => {
  it('reads valid errorCode from metadata JSON', () => {
    expect(
      parseErrorCodeFromMetadata(JSON.stringify({ errorCode: 'upstream_timeout' })),
    ).toBe('upstream_timeout')
  })

  it('returns undefined for missing or invalid metadata', () => {
    expect(parseErrorCodeFromMetadata(null)).toBeUndefined()
    expect(parseErrorCodeFromMetadata('{')).toBeUndefined()
    expect(parseErrorCodeFromMetadata(JSON.stringify({ errorCode: 'nope' }))).toBeUndefined()
  })
})

describe('buildPollingFailurePatch', () => {
  it('persists generationRecordId and errorCode from studio metadata', () => {
    expect(
      buildPollingFailurePatch({
        metadata: JSON.stringify({ errorCode: 'upstream_timeout', refundedPoints: 5 }),
        generationRecordId: 'rec-1',
      }),
    ).toEqual({
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '生成失败，5 积分已返回',
      generationRecordId: 'rec-1',
      errorCode: 'upstream_timeout',
    })
  })

  it('persists materialId on shot/material failures', () => {
    expect(
      buildPollingFailurePatch({
        metadata: JSON.stringify({ errorCode: 'upstream_error' }),
        materialId: 'mat-1',
      }),
    ).toEqual({
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '生成失败',
      materialId: 'mat-1',
      errorCode: 'upstream_error',
    })
  })

  it('omits errorCode when metadata has none', () => {
    const patch = buildPollingFailurePatch({
      generationRecordId: 'rec-2',
    })
    expect(patch).toEqual({
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '生成失败',
      generationRecordId: 'rec-2',
    })
    expect(patch).not.toHaveProperty('errorCode')
  })
})

describe('buildCopyForNode', () => {
  it('buildCopyForNode merges node context', () => {
    const text = buildCopyForNode(
      {
        userMessage: 'x',
        code: 'unknown',
        taskKind: 'generation',
        taskId: 'g1',
        occurredAt: 't',
        providerSnippet: null,
      },
      { nodeId: 'n1', nodeLabel: '文本', sessionId: 's1' },
    )
    expect(text).toContain('nodeId: n1')
    expect(text).toContain('sessionId: s1')
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

  it('retries after fetch rejection', async () => {
    const cache = createDiagnosticCache()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ taskId: 'g1', code: 'unknown' })

    await expect(cache.get('generation', 'g1', fetcher)).rejects.toThrow('network')
    const result = await cache.get('generation', 'g1', fetcher)
    expect(result).toEqual({ taskId: 'g1', code: 'unknown' })
    expect(fetcher).toHaveBeenCalledTimes(2)
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
