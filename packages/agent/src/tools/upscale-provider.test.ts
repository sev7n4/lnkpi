import { describe, expect, it, vi, afterEach } from 'vitest'
import { createUpscaleProviders } from './upscale-provider'

describe('createUpscaleProviders', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns empty without credentials', () => {
    expect(createUpscaleProviders({})).toEqual([])
  })

  it('returns empty when only Agnes credentials (probe: Agnes has no real upscale API)', () => {
    expect(
      createUpscaleProviders({
        agnesApiKey: 'k',
        agnesBaseUrl: 'https://apihub.agnes-ai.com/v1',
      }),
    ).toEqual([])
  })

  it('fal esrgan upscales 2x/4x via fal.run', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://fal.run/fal-ai/esrgan')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({
        Authorization: 'Key fal-k',
        'Content-Type': 'application/json',
      })
      const body = JSON.parse(String(init?.body))
      expect(body.image_url).toBe('https://in/a.png')
      expect(body.scale).toBe(2)
      expect(body.output_format).toBe('png')
      return new Response(
        JSON.stringify({
          image: { url: 'https://out/hi.png' },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const providers = createUpscaleProviders({ falApiKey: 'fal-k' })
    expect(providers.map((p) => p.id)).toEqual(['fal'])
    expect(providers[0].supportsScale(2)).toBe(true)
    expect(providers[0].supportsScale(4)).toBe(true)

    const out = await providers[0].upscale({
      imageUrl: 'https://in/a.png',
      scale: 2,
    })
    expect(out).toEqual({
      url: 'https://out/hi.png',
      providerId: 'fal',
      modelId: expect.any(String),
    })
  })

  it('fal esrgan posts scale 4', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.scale).toBe(4)
      return new Response(JSON.stringify({ image: { url: 'https://out/4x.png' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const providers = createUpscaleProviders({ falApiKey: 'fal-k' })
    const out = await providers[0].upscale({ imageUrl: 'https://in/a.png', scale: 4 })
    expect(out.url).toBe('https://out/4x.png')
  })

  it('throws when fal response has no image url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    )
    const providers = createUpscaleProviders({ falApiKey: 'fal-k' })
    await expect(providers[0].upscale({ imageUrl: 'https://in/a.png', scale: 2 })).rejects.toThrow(
      /url/i,
    )
  })
})
