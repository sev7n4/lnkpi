import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageProvider, OpenAIImageProvider } from './image-provider'

describe('createImageProvider', () => {
  const env = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env = { ...env }
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1'
    process.env.OPENAI_IMAGE_MODEL = 'env-image'
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = env
    vi.unstubAllGlobals()
  })

  it('uses explicit opts over env credentials', async () => {
    const provider = createImageProvider({
      apiKey: 'opts-key',
      baseUrl: 'https://opts.example.com/v1',
      model: 'opts-image',
    })
    expect(provider).toBeInstanceOf(OpenAIImageProvider)
    await provider.generate('a cat', { n: 1 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://opts.example.com/v1/images/generations')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer opts-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'opts-image' })
  })
})

describe('OpenAIImageProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses options.modelId in request body', async () => {
    const provider = new OpenAIImageProvider('test-key', 'https://api.example.com/v1', 'dall-e-3')
    await provider.generate('a cat', { modelId: 'dall-e-2', size: '512x512', n: 1 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'dall-e-2',
      prompt: 'a cat',
      size: '512x512',
    })
  })
})
