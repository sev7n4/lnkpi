import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAL_H3_MAX_ENDPOINTS, FalH3MaxVideoProvider } from './fal-h3-max-video-provider'

describe('FAL_H3_MAX_ENDPOINTS', () => {
  it('locks turbo and max t2v/i2v paths', () => {
    expect(FAL_H3_MAX_ENDPOINTS).toEqual({
      'h3-max-turbo': {
        t2v: 'minimax/h3-max-turbo/text-to-video',
        i2v: 'minimax/h3-max-turbo/image-to-video',
      },
      'h3-max': {
        t2v: 'minimax/h3-max/text-to-video',
        i2v: 'minimax/h3-max/image-to-video',
      },
    })
  })
})

describe('FalH3MaxVideoProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockQueueSuccess(url = 'https://cdn.fal.ai/video.mp4') {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status_url: 'https://queue.fal.run/status/1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          response: { video: { url } },
        }),
      })
  }

  it('T2V posts to turbo text-to-video endpoint', async () => {
    mockQueueSuccess()
    const provider = new FalH3MaxVideoProvider('fal-secret', 'https://fal.run')
    await provider.generate('cinematic rain', {
      model: 'h3-max-turbo',
      duration: 6.4,
      aspectRatio: '16:9',
      resolution: '480p',
      pollIntervalMs: 0,
      maxPollMs: 30_000,
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://queue.fal.run/${FAL_H3_MAX_ENDPOINTS['h3-max-turbo'].t2v}`)
    expect(init.headers).toMatchObject({ Authorization: 'Key fal-secret' })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      prompt: 'cinematic rain',
      duration: 6,
      aspect_ratio: '16:9',
      resolution: '480P',
    })
    expect(body).not.toHaveProperty('prompt_expansion_mode')
    expect(body).not.toHaveProperty('image_url')
  })

  it('I2V with end image sends image_url and end_image_url', async () => {
    mockQueueSuccess('https://cdn.fal.ai/i2v.mp4')
    const provider = new FalH3MaxVideoProvider('fal-secret', 'https://fal.run', 'h3-max')
    const { url } = await provider.generate('walk through the door', {
      model: 'minimax/h3-max',
      duration: 8,
      aspectRatio: '9:16',
      resolution: '768p',
      referenceImages: ['https://cdn/first.png', 'https://cdn/last.png'],
      pollIntervalMs: 0,
      maxPollMs: 30_000,
    })

    expect(url).toBe('https://cdn.fal.ai/i2v.mp4')
    const [submitUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(submitUrl).toBe(`https://queue.fal.run/${FAL_H3_MAX_ENDPOINTS['h3-max'].i2v}`)
    expect(init.headers).toMatchObject({ Authorization: 'Key fal-secret' })
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'walk through the door',
      duration: 8,
      aspect_ratio: '9:16',
      resolution: '768P',
      image_url: 'https://cdn/first.png',
      end_image_url: 'https://cdn/last.png',
    })
  })

  it('maps I2V start from image and end from imageWithRoles last role', async () => {
    mockQueueSuccess()
    const provider = new FalH3MaxVideoProvider('fal-secret')
    await provider.generate('morph', {
      model: 'h3-max-turbo',
      image: 'https://cdn/start.png',
      imageWithRoles: [{ url: 'https://cdn/end.png', role: 'last_frame' }],
      pollIntervalMs: 0,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://queue.fal.run/${FAL_H3_MAX_ENDPOINTS['h3-max-turbo'].i2v}`,
    )
    expect(body.image_url).toBe('https://cdn/start.png')
    expect(body.end_image_url).toBe('https://cdn/end.png')
  })

  it('maps TOP_UP 403 to readable Error', async () => {
    const status = 403
    const body = JSON.stringify({ detail: 'TOP_UP required', error: 'account locked' })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status,
      text: async () => body,
    })

    const provider = new FalH3MaxVideoProvider('fal-secret', 'https://fal.run')
    await expect(
      provider.generate('blocked', { model: 'h3-max-turbo', pollIntervalMs: 0 }),
    ).rejects.toThrow('视频服务账户异常，请稍后重试或联系管理员')
    expect(status).toBe(403)
    expect(body).toMatch(/TOP_UP/)
    expect(body).toMatch(/locked/)
  })
})
