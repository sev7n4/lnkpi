import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioProvider, OpenAITTSProvider } from './audio-provider'

describe('createAudioProvider', () => {
  const env = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env = { ...env }
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1'
    process.env.OPENAI_TTS_MODEL = 'env-tts'
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = env
    vi.unstubAllGlobals()
  })

  it('uses explicit opts over env credentials', async () => {
    const provider = createAudioProvider({
      apiKey: 'opts-key',
      baseUrl: 'https://opts.example.com/v1',
      model: 'opts-tts',
    })
    expect(provider).toBeInstanceOf(OpenAITTSProvider)
    await provider.generate('hello')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://opts.example.com/v1/audio/speech')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer opts-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'opts-tts' })
  })
})

describe('OpenAITTSProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes model, voice, speed, volume, pitch, emotion in request body', async () => {
    const provider = new OpenAITTSProvider('test-key', 'https://api.example.com/v1', 'tts-1')
    await provider.generate('hello', {
      model: 'tts-1-hd',
      voice: 'nova',
      speed: 1.2,
      volume: 0.8,
      pitch: 1.1,
      emotion: 'happy',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'tts-1-hd',
      input: 'hello',
      voice: 'nova',
      speed: 1.2,
      volume: 0.8,
      pitch: 1.1,
      emotion: 'happy',
    })
  })

  it('accepts legacy voice string overload', async () => {
    const provider = new OpenAITTSProvider('test-key', 'https://api.example.com/v1', 'tts-1')
    await provider.generate('hello', 'shimmer')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'tts-1',
      voice: 'shimmer',
    })
  })

  it('defaults voice to alloy when options omitted', async () => {
    const provider = new OpenAITTSProvider('test-key', 'https://api.example.com/v1', 'tts-1')
    await provider.generate('hello')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ voice: 'alloy' })
  })
})
