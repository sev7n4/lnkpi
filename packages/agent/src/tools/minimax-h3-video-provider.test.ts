import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MiniMaxH3VideoProvider,
  isMiniMaxBaseUrl,
  isMiniMaxH3Model,
  normalizeMiniMaxBaseUrl,
} from './minimax-h3-video-provider'

describe('isMiniMaxH3Model', () => {
  it('matches catalog minimax-h3 and gateway MiniMax-H3 case-insensitively', () => {
    expect(isMiniMaxH3Model('minimax-h3')).toBe(true)
    expect(isMiniMaxH3Model('MiniMax-H3')).toBe(true)
    expect(isMiniMaxH3Model('MINIMAX-H3')).toBe(true)
  })

  it('rejects fal max keys and official H3-Max', () => {
    expect(isMiniMaxH3Model('h3-max')).toBe(false)
    expect(isMiniMaxH3Model('h3-max-turbo')).toBe(false)
    expect(isMiniMaxH3Model('minimax/h3-max-turbo')).toBe(false)
    expect(isMiniMaxH3Model('MiniMax-H3-Max')).toBe(false)
    expect(isMiniMaxH3Model(undefined)).toBe(false)
  })
})

describe('isMiniMaxBaseUrl', () => {
  it('detects api.minimax.io and rejects attacker suffix hosts', () => {
    expect(isMiniMaxBaseUrl('https://api.minimax.io')).toBe(true)
    expect(isMiniMaxBaseUrl('https://api.minimax.io/v2')).toBe(true)
    expect(isMiniMaxBaseUrl('https://minimax.io.attacker.example')).toBe(false)
    expect(isMiniMaxBaseUrl('https://fal.run')).toBe(false)
    expect(isMiniMaxBaseUrl(undefined)).toBe(false)
  })
})

describe('normalizeMiniMaxBaseUrl', () => {
  it('normalizes base without duplicating /v2', () => {
    expect(normalizeMiniMaxBaseUrl()).toBe('https://api.minimax.io')
    expect(normalizeMiniMaxBaseUrl('https://api.minimax.io')).toBe('https://api.minimax.io')
    expect(normalizeMiniMaxBaseUrl('https://api.minimax.io/')).toBe('https://api.minimax.io')
    expect(normalizeMiniMaxBaseUrl('https://api.minimax.io/v2')).toBe('https://api.minimax.io/v2')
    expect(normalizeMiniMaxBaseUrl('https://api.minimax.io/v2/')).toBe('https://api.minimax.io/v2')
  })
})

describe('MiniMaxH3VideoProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockCreateAndSucceed(url = 'https://cdn/v.mp4') {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task_id: 't1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'succeeded', content: { url } }),
      })
  }

  it('T2V posts content text and required ratio', async () => {
    mockCreateAndSucceed()
    const p = new MiniMaxH3VideoProvider('mm-key', 'https://api.minimax.io', 'minimax-h3')
    const r = await p.generate('a cat walks', {
      duration: 5,
      aspectRatio: '16:9',
      resolution: '768p',
      pollIntervalMs: 0,
    })

    expect(r.url).toBe('https://cdn/v.mp4')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.minimax.io/v2/video_generation')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer mm-key' })
    expect(init.headers).not.toMatchObject({ Authorization: 'Key mm-key' })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('MiniMax-H3')
    expect(body.content).toEqual([{ type: 'text', text: 'a cat walks' }])
    expect(body.ratio).toBe('16:9')
    expect(body.ratio).not.toBe('adaptive')
    expect(body.duration).toBe(5)
    expect(body.resolution).toBe('768P')

    const [pollUrl, pollInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(pollUrl).toBe('https://api.minimax.io/v2/query/video_generation/t1')
    expect(pollInit.headers).toMatchObject({ Authorization: 'Bearer mm-key' })
  })

  it('does not duplicate /v2 when base already ends with /v2', async () => {
    mockCreateAndSucceed()
    const p = new MiniMaxH3VideoProvider('mm-key', 'https://api.minimax.io/v2', 'minimax-h3')
    await p.generate('a cat walks', { duration: 5, pollIntervalMs: 0 })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.minimax.io/v2/video_generation')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.minimax.io/v2/query/video_generation/t1')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/v2/v2/')
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('/v2/v2/')
  })

  it('I2V sends first_frame and omits ratio', async () => {
    mockCreateAndSucceed('https://cdn/i2v.mp4')
    const p = new MiniMaxH3VideoProvider('mm-key', 'https://api.minimax.io', 'minimax-h3')
    const r = await p.generate('walk in', {
      image: 'https://cdn/first.png',
      duration: 6,
      aspectRatio: '16:9',
      resolution: '2k',
      pollIntervalMs: 0,
    })

    expect(r.url).toBe('https://cdn/i2v.mp4')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>
    expect(body.model).toBe('MiniMax-H3')
    expect(body.content).toEqual([
      { type: 'text', text: 'walk in' },
      { type: 'image_url', image_url: { url: 'https://cdn/first.png' }, role: 'first_frame' },
    ])
    expect(body).not.toHaveProperty('ratio')
    expect(body.resolution).toBe('2K')
    expect(body.duration).toBe(6)
  })

  it('first last sends first_frame and last_frame', async () => {
    mockCreateAndSucceed()
    const p = new MiniMaxH3VideoProvider('mm-key')
    await p.generate('door open', {
      referenceImages: ['https://cdn/first.png', 'https://cdn/last.png'],
      duration: 8,
      pollIntervalMs: 0,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>
    expect(body.content).toEqual([
      { type: 'text', text: 'door open' },
      { type: 'image_url', image_url: { url: 'https://cdn/first.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://cdn/last.png' }, role: 'last_frame' },
    ])
    expect(body).not.toHaveProperty('ratio')
  })

  it('maps last_frame from imageWithRoles end role', async () => {
    mockCreateAndSucceed()
    const p = new MiniMaxH3VideoProvider('mm-key')
    await p.generate('morph', {
      image: 'https://cdn/start.png',
      imageWithRoles: [{ url: 'https://cdn/end.png', role: 'last_frame' }],
      pollIntervalMs: 0,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>
    expect(body.content).toEqual([
      { type: 'text', text: 'morph' },
      { type: 'image_url', image_url: { url: 'https://cdn/start.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://cdn/end.png' }, role: 'last_frame' },
    ])
    expect(body).not.toHaveProperty('ratio')
  })

  it('returns url from official nested task wrapper on poll', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task_id: 't-nested' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: { status: 'succeeded', content: { url: 'https://cdn/nested.mp4' } },
        }),
      })
    const p = new MiniMaxH3VideoProvider('mm-key')
    const r = await p.generate('nested task', { pollIntervalMs: 0 })
    expect(r.url).toBe('https://cdn/nested.mp4')
  })

  it('throws when poll status is failed or cancelled', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task_id: 't-fail' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'failed' }) })
    const failed = new MiniMaxH3VideoProvider('mm-key')
    await expect(failed.generate('oops', { pollIntervalMs: 0 })).rejects.toThrow(/failed/)

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task_id: 't-cancel' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'cancelled' }) })
    const cancelled = new MiniMaxH3VideoProvider('mm-key')
    await expect(cancelled.generate('stop', { pollIntervalMs: 0 })).rejects.toThrow(/cancelled/)
  })

  it('maps 401/403 to readable account error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'insufficient balance' }),
    })
    const p = new MiniMaxH3VideoProvider('mm-key')
    await expect(p.generate('blocked', { pollIntervalMs: 0 })).rejects.toThrow(
      '视频服务账户异常，请稍后重试或联系管理员',
    )
  })

  it('maps HTTP 402 insufficient_balance_error to readable account error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: { type: 'insufficient_balance_error' } }),
    })
    const p = new MiniMaxH3VideoProvider('mm-key')
    await expect(p.generate('no credits', { pollIntervalMs: 0 })).rejects.toThrow(
      '视频服务账户异常，请稍后重试或联系管理员',
    )
  })
})
