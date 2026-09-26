import { describe, expect, it } from 'vitest'
import {
  formatDiagnosticCopy,
  redactProviderSnippet,
  mapMessageToErrorCode,
  translateUpstreamFailure,
} from './generationDiagnostics'

describe('redactProviderSnippet', () => {
  it('redacts bearer tokens and truncates', () => {
    const raw = `Authorization: Bearer sk-live-abc123secret\nemail user@example.com\n${'x'.repeat(3000)}`
    const out = redactProviderSnippet(raw, 200)
    expect(out).not.toContain('sk-live-abc123secret')
    expect(out).not.toMatch(/user@example\.com/)
    expect(out.length).toBeLessThanOrEqual(220)
    expect(out).toContain('truncated')
  })
})

describe('formatDiagnosticCopy', () => {
  it('formats stable key lines including nodeId and taskId', () => {
    const text = formatDiagnosticCopy({
      userMessage: '上游超时',
      code: 'upstream_timeout',
      taskKind: 'generation',
      taskId: 'gen_1',
      nodeId: 'node_1',
      occurredAt: '2026-07-21T00:00:00.000Z',
      providerSnippet: 'timeout of 90000ms exceeded',
    })
    expect(text).toContain('lnkpi diagnostic')
    expect(text).toContain('code: upstream_timeout')
    expect(text).toContain('taskId: gen_1')
    expect(text).toContain('nodeId: node_1')
    expect(text).toContain('providerSnippet:')
  })
})

describe('mapMessageToErrorCode', () => {
  it('maps known phrases', () => {
    expect(mapMessageToErrorCode('积分不足')).toBe('insufficient_points')
    expect(mapMessageToErrorCode('timeout of 90000ms exceeded')).toBe('upstream_timeout')
    expect(mapMessageToErrorCode('weird')).toBe('unknown')
  })
})

describe('translateUpstreamFailure', () => {
  it('translates real-world upstream failures (2026-09-26 incidents)', () => {
    expect(
      translateUpstreamFailure(
        'Segment API 403: {"detail":"User is locked. Reason: TOP_UP."}',
      ),
    ).toBe('上游生成服务账户已被锁定（欠费），请联系管理员充值后重试')
    expect(
      translateUpstreamFailure(
        'Image edit API 402: {"error":{"message":"[token_id=90701] insufficient balance (current: 0.013570 USD, required: 0.050000 USD)"}}',
      ),
    ).toBe('上游生成服务余额不足，请联系管理员充值后重试')
    expect(translateUpstreamFailure('fetch failed')).toBe(
      '无法连接上游生成服务（网络异常），请稍后重试',
    )
  })

  it('translates auth and rate-limit failures', () => {
    expect(translateUpstreamFailure('Image API 401: unauthorized')).toBe(
      '上游生成服务鉴权失败，请检查服务配置',
    )
    expect(translateUpstreamFailure('Image API 429: too many requests')).toBe(
      '上游生成服务限流，请稍后重试',
    )
  })

  it('returns undefined for ordinary errors so callers keep their fallback copy', () => {
    expect(translateUpstreamFailure('Image edit API returned no urls')).toBeUndefined()
    expect(translateUpstreamFailure('')).toBeUndefined()
  })
})
