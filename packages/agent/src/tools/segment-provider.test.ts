import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSegmentProvider } from './segment-provider'

describe('createSegmentProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts point prompt to fal.run and returns masks[0].url', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        masks: [{ url: 'https://fal.media/mask.png' }],
      }),
    } as Response)
    const provider = createSegmentProvider({ apiKey: 'fal-test' })
    const out = await provider.segment({ imageUrl: 'https://cdn/a.png', x: 12, y: 34, label: 1 })
    expect(out.maskUrl).toBe('https://fal.media/mask.png')
    expect(fetch).toHaveBeenCalledWith(
      'https://fal.run/fal-ai/sam-3/image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Key fal-test' }),
      }),
    )
    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body))
    expect(body.point_prompts).toEqual([{ x: 12, y: 34, label: 1 }])
    expect(body.image_url).toBe('https://cdn/a.png')
    expect(body.return_multiple_masks).toBe(false)
    expect(body.apply_mask).toBe(false)
    expect(body.output_format).toBe('png')
  })

  it('falls back to image.url when masks is empty', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        image: { url: 'https://fal.media/fallback.png' },
      }),
    } as Response)
    const provider = createSegmentProvider({ apiKey: 'fal-test' })
    const out = await provider.segment({ imageUrl: 'https://cdn/a.png', x: 1, y: 2 })
    expect(out.maskUrl).toBe('https://fal.media/fallback.png')
  })

  it('throws when response has no mask url', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    const provider = createSegmentProvider({ apiKey: 'fal-test' })
    await expect(provider.segment({ imageUrl: 'https://cdn/a.png', x: 1, y: 2 })).rejects.toThrow(
      /mask/i,
    )
  })

  it('uses custom falModel when provided', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        masks: [{ url: 'https://fal.media/mask.png' }],
      }),
    } as Response)
    const provider = createSegmentProvider({ apiKey: 'fal-test', falModel: 'custom/sam' })
    await provider.segment({ imageUrl: 'https://cdn/a.png', x: 0, y: 0 })
    expect(fetch).toHaveBeenCalledWith('https://fal.run/custom/sam', expect.any(Object))
  })
})
