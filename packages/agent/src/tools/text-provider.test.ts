import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTextProvider, OpenAITextProvider } from './text-provider'

describe('createTextProvider', () => {
  const env = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env = { ...env }
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1'
    process.env.OPENAI_CHAT_MODEL = 'env-model'
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = env
    vi.unstubAllGlobals()
  })

  it('uses explicit opts over env credentials', async () => {
    const provider = createTextProvider({
      apiKey: 'opts-key',
      baseUrl: 'https://opts.example.com/v1',
      model: 'opts-model',
    })
    expect(provider).toBeInstanceOf(OpenAITextProvider)
    await provider.generate('hello')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://opts.example.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer opts-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'opts-model' })
  })

  it('falls back to env when apiKey is omitted', async () => {
    const provider = createTextProvider()
    await provider.generate('hello')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://env.example.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer env-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'env-model' })
  })
})
