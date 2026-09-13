import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveFalQueueBase, runFalVideoQueue } from './fal-video-queue'

describe('resolveFalQueueBase', () => {
  it('maps https://fal.run to https://queue.fal.run', () => {
    expect(resolveFalQueueBase('https://fal.run')).toBe('https://queue.fal.run')
  })

  it('keeps queue.fal.run unchanged', () => {
    expect(resolveFalQueueBase('https://queue.fal.run')).toBe('https://queue.fal.run')
    expect(resolveFalQueueBase('https://queue.fal.run/extra')).toBe('https://queue.fal.run')
  })

  it('prefixes queue. on other fal.run-style hosts', () => {
    expect(resolveFalQueueBase('https://eu.fal.run')).toBe('https://queue.eu.fal.run')
  })

  it('strips path from fal.run bases', () => {
    expect(resolveFalQueueBase('https://fal.run/v1')).toBe('https://queue.fal.run')
  })

  it('defaults empty or unknown bases to queue.fal.run', () => {
    expect(resolveFalQueueBase()).toBe('https://queue.fal.run')
    expect(resolveFalQueueBase('')).toBe('https://queue.fal.run')
    expect(resolveFalQueueBase('https://fal.ai')).toBe('https://queue.fal.run')
  })
})

describe('runFalVideoQueue', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits then polls status_url until COMPLETED and returns response.video.url', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-1',
          status_url:
            'https://queue.fal.run/minimax/h3-max-turbo/text-to-video/requests/req-1/status',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'IN_QUEUE' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          response: { video: { url: 'https://cdn.fal.ai/out.mp4' } },
        }),
      })

    const result = await runFalVideoQueue({
      apiKey: 'fal-key',
      baseUrl: 'https://fal.run',
      endpointId: 'minimax/h3-max-turbo/text-to-video',
      input: { prompt: 'a cat' },
      pollIntervalMs: 0,
      maxPollMs: 30_000,
    })

    expect(result.url).toBe('https://cdn.fal.ai/out.mp4')

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(submitUrl).toBe('https://queue.fal.run/minimax/h3-max-turbo/text-to-video')
    expect(submitInit.method).toBe('POST')
    expect(submitInit.headers).toMatchObject({
      Authorization: 'Key fal-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(submitInit.body))).toEqual({ prompt: 'a cat' })

    const [statusUrl, statusInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(statusUrl).toBe(
      'https://queue.fal.run/minimax/h3-max-turbo/text-to-video/requests/req-1/status',
    )
    expect(statusInit.headers).toMatchObject({ Authorization: 'Key fal-key' })
  })
})
