import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIImageProvider } from './image-provider'

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
