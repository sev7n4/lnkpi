/** @vitest-environment node */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildIdempotencyKey, shouldPollRuntimeHealth, checkRuntimeHealthViaNest } from './streamRecovery'

vi.mock('@/services/api-base', () => ({
  apiUrl: (path: string) => `http://localhost:5100${path.startsWith('/') ? path : `/${path}`}`,
}))

describe('buildIdempotencyKey', () => {
  it('generates key with thread ID, timestamp, and random suffix', () => {
    const key = buildIdempotencyKey('thread-123')
    expect(key).toMatch(/^ik_thread-123_\d+_[a-z0-9]{4}$/)
  })

  it('generates unique keys on successive calls', () => {
    const keys = new Set(Array.from({ length: 10 }, () => buildIdempotencyKey('t1')))
    expect(keys.size).toBe(10)
  })
})

describe('shouldPollRuntimeHealth', () => {
  it('returns true when content has busy indicators without completion', () => {
    expect(shouldPollRuntimeHealth('上一轮仍在处理中，请稍候')).toBe(true)
    expect(shouldPollRuntimeHealth('出图仍在进行中')).toBe(true)
    expect(shouldPollRuntimeHealth('正在生成图片')).toBe(true)
  })

  it('returns false when content has completion indicators', () => {
    expect(shouldPollRuntimeHealth('出图成功')).toBe(false)
    expect(shouldPollRuntimeHealth('已将确认的主文案写入')).toBe(false)
    expect(shouldPollRuntimeHealth('自动出图完成')).toBe(false)
  })

  it('returns false when content has no relevant indicators', () => {
    expect(shouldPollRuntimeHealth('方案确认成功')).toBe(false)
    expect(shouldPollRuntimeHealth('')).toBe(false)
  })

  it('returns false when both busy and done indicators present', () => {
    expect(shouldPollRuntimeHealth('上一轮仍在处理中，但出图成功')).toBe(false)
  })
})

describe('checkRuntimeHealthViaNest', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns health data when API responds ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { ok: true, latencyMs: 42 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await checkRuntimeHealthViaNest()
    expect(result).toEqual({ ok: true, latencyMs: 42 })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5100/agent/runtime-health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns null when API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await checkRuntimeHealthViaNest()
    expect(result).toBeNull()
  })

  it('returns null when API returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await checkRuntimeHealthViaNest()
    expect(result).toBeNull()
  })
})
