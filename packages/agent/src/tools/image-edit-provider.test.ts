import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditProvider } from './image-edit-provider'

describe('createImageEditProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts mask_url to /images/generations and returns completed url', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/images/generations') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(body.mask_url).toBe('https://cdn/mask.png')
        expect(body.image_urls).toEqual(['https://cdn/base.png'])
        expect(body.size).toBe('auto')
        return new Response(JSON.stringify({ data: { task_id: 't1' } }), { status: 200 })
      }
      if (url.endsWith('/tasks/t1')) {
        return new Response(
          JSON.stringify({
            data: {
              status: 'completed',
              result: { images: [{ url: 'https://cdn/out.png' }] },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createImageEditProvider({
      apiKey: 'k',
      baseUrl: 'https://api.apimart.ai/v1',
      model: 'gpt-image-2-official',
    })
    const out = await provider.edit({
      userPrompt: '去污渍',
      imageUrl: 'https://cdn/base.png',
      maskUrl: 'https://cdn/mask.png',
      pollIntervalMs: 1,
      maxPollMs: 1000,
    })
    expect(out.url).toBe('https://cdn/out.png')
  })

  it('throws missing api key when credentials are absent', () => {
    expect(() => createImageEditProvider()).toThrow('missing api key')
  })

  it('overrides body.model with input.modelId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/images/generations') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(body.model).toBe('gpt-image-2-override')
        return new Response(JSON.stringify({ data: { task_id: 't2' } }), { status: 200 })
      }
      if (url.endsWith('/tasks/t2')) {
        return new Response(
          JSON.stringify({
            data: {
              status: 'completed',
              result: { images: [{ url: 'https://cdn/out2.png' }] },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createImageEditProvider({
      apiKey: 'k',
      baseUrl: 'https://api.apimart.ai/v1',
    })
    const out = await provider.edit({
      userPrompt: '去污渍',
      imageUrl: 'https://cdn/base.png',
      maskUrl: 'https://cdn/mask.png',
      modelId: 'gpt-image-2-override',
      pollIntervalMs: 1,
      maxPollMs: 1000,
    })
    expect(out.url).toBe('https://cdn/out2.png')
  })
})
