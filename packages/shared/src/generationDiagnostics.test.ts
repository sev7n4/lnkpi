import { describe, expect, it } from 'vitest'
import {
  formatDiagnosticCopy,
  redactProviderSnippet,
  mapMessageToErrorCode,
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
