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

  it('sends extra_body.image for agnes-image single-ref img2img', async () => {
    const provider = new OpenAIImageProvider(
      'test-key',
      'https://apihub.agnes-ai.com/v1',
      'agnes-image-2.0-flash',
    )
    await provider.generate('white background product photo', {
      modelId: 'agnes-image-2.0-flash',
      size: '1024x768',
      n: 1,
      referenceImages: ['https://cdn.example/ref.jpg'],
      refWire: 'agnes_extra_body',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'agnes-image-2.0-flash',
      prompt: 'white background product photo',
      n: 1,
      size: '1024x768',
      extra_body: {
        image: ['https://cdn.example/ref.jpg'],
        response_format: 'url',
      },
    })
  })

  it('sends image_urls for apimart seedream img2img', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          data: [{ status: 'submitted', task_id: 'task_abc' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            status: 'completed',
            result: { images: [{ url: ['https://cdn.example/out.png'] }] },
          },
        }),
      })

    const provider = new OpenAIImageProvider(
      'test-key',
      'https://api.apimart.ai/v1',
      'doubao-seedream-5-0-pro',
    )
    const result = await provider.generate('product on white background', {
      modelId: 'doubao-seedream-5-0-pro',
      size: '16:9',
      resolution: '2K',
      n: 1,
      referenceImages: ['https://cdn.example/ref.jpg'],
      refWire: 'apimart_image_urls',
      responseMode: 'async_task',
      pollIntervalMs: 1,
      maxPollMs: 1000,
    })

    expect(result.url).toBe('https://cdn.example/out.png')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'doubao-seedream-5-0-pro',
      size: '16:9',
      resolution: '2K',
      image_urls: ['https://cdn.example/ref.jpg'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends all reference images in extra_body.image for agnes multi-ref', async () => {
    const provider = new OpenAIImageProvider(
      'test-key',
      'https://apihub.agnes-ai.com/v1',
      'agnes-image-2.0-flash',
    )
    await provider.generate('combine these into one scene', {
      modelId: 'agnes-image-2.0-flash',
      size: '1024x768',
      n: 1,
      refWire: 'agnes_extra_body',
      referenceImages: [
        'https://cdn.example/a.png',
        'https://cdn.example/b.png',
        'https://cdn.example/c.png',
      ],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      extra_body: {
        image: [
          'https://cdn.example/a.png',
          'https://cdn.example/b.png',
          'https://cdn.example/c.png',
        ],
        response_format: 'url',
      },
    })
  })
})
