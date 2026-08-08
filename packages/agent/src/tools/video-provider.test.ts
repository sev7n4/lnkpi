import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgnesVideoProvider,
  ApimartVideoProvider,
  createVideoProvider,
  resolveVideoParams,
} from './video-provider'

describe('createVideoProvider', () => {
  const env = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env = { ...env }
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1'
    process.env.OPENAI_VIDEO_MODEL = 'env-video'
    fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', url: 'https://example.com/video.mp4' }),
      })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = env
    vi.unstubAllGlobals()
  })

  it('uses explicit opts over env credentials for Agnes', async () => {
    const provider = createVideoProvider({
      apiKey: 'opts-key',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'opts-video',
    })
    expect(provider).toBeInstanceOf(AgnesVideoProvider)
    await provider.generate('animate')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://apihub.agnes-ai.com/v1/videos')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer opts-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'opts-video' })
  })
})


describe('createVideoProvider apimart', () => {
  const env = { ...process.env }

  beforeEach(() => {
    process.env = { ...env }
  })

  afterEach(() => {
    process.env = env
  })

  it('returns ApimartVideoProvider for apimart baseUrl', () => {
    const p = createVideoProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://api.apimart.ai/v1',
      model: 'doubao-seedance-2.0-mini',
    })
    expect(p).toBeInstanceOf(ApimartVideoProvider)
  })

  it('rejects apimart.ai suffix attacker domains', async () => {
    const p = createVideoProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://apimart.ai.attacker.example/v1',
    })
    expect(p).not.toBeInstanceOf(ApimartVideoProvider)
    await expect(p.generate('test')).rejects.toThrow(/unsupported video gateway/i)
  })

  it('throws readable error for unknown BYOK instead of placeholder', async () => {
    const p = createVideoProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://unknown.example.com/v1',
    })
    await expect(p.generate('test')).rejects.toThrow(/unsupported video gateway/i)
  })
})

describe('ApimartVideoProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('polls apimart task and returns video url', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ task_id: 'task_1' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'completed', result: { video_url: 'https://cdn/v.mp4' } } }),
      })
    const provider = new ApimartVideoProvider('key', 'https://api.apimart.ai/v1', 0, 30_000)
    const { url } = await provider.generate('hello', { model: 'doubao-seedance-2.0-mini', duration: 5 })
    expect(url).toBe('https://cdn/v.mp4')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).image_urls).toBeUndefined()
  })

  it('normalizes apimart result.url when returned as string array', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ task_id: 'task_arr' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            status: 'completed',
            result: {
              url: [
                'https://getapib.org/video/9998213808887624-db838584-132d-48ee-a487-440a1a26f801-video_task_01KZGMCY3V95MGPWVY46C3NWF3.mp4',
              ],
            },
          },
        }),
      })
    const provider = new ApimartVideoProvider('key', 'https://api.apimart.ai/v1', 0, 30_000)
    const { url } = await provider.generate('hello', { model: 'doubao-seedance-2.0-mini', duration: 5 })
    expect(url).toBe(
      'https://getapib.org/video/9998213808887624-db838584-132d-48ee-a487-440a1a26f801-video_task_01KZGMCY3V95MGPWVY46C3NWF3.mp4',
    )
  })
})

describe('resolveVideoParams', () => {
  it('maps duration to 8n+1 frames at 24fps', () => {
    const five = resolveVideoParams(5, '16:9')
    expect(five.num_frames).toBe(121)
    expect(five.frame_rate).toBe(24)
  })

  it('caps frames at 441', () => {
    const long = resolveVideoParams(60, '16:9')
    expect(long.num_frames).toBe(441)
  })

  it('maps aspect ratios at 720p', () => {
    expect(resolveVideoParams(5, '9:16', '720p')).toEqual(
      expect.objectContaining({ width: 720, height: 1280 }),
    )
    expect(resolveVideoParams(5, '1:1', '720p')).toEqual(
      expect.objectContaining({ width: 720, height: 720 }),
    )
    expect(resolveVideoParams(5, '16:9', '720p')).toEqual(
      expect.objectContaining({ width: 1280, height: 720 }),
    )
  })

  it('maps 1080p long edge', () => {
    expect(resolveVideoParams(5, '16:9', '1080p')).toEqual(
      expect.objectContaining({ width: 1920, height: 1080 }),
    )
  })
})

describe('AgnesVideoProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes image in create body but not crop', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', url: 'https://example.com/video.mp4' }),
      })

    const provider = new AgnesVideoProvider('test-key')
    await provider.generate('animate this', {
      model: 'agnes-video-v2.0',
      image: 'https://example.com/ref.png',
      crop: 'center',
    })

    const createCall = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(createCall[1].body)) as Record<string, unknown>
    expect(body.image).toBe('https://example.com/ref.png')
    expect(body).not.toHaveProperty('crop')
    expect(body.model).toBe('agnes-video-v2.0')
  })

  it('sends extra_body keyframes when referenceImages length >= 2', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-kf' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', url: 'https://example.com/kf.mp4' }),
      })

    const provider = new AgnesVideoProvider('test-key', 'https://apihub.agnes-ai.com/v1', 'https://apihub.agnes-ai.com', 'agnes-video-v2.0', 0)
    await provider.generate('transition', {
      referenceImages: ['https://cdn/a.png', 'https://cdn/b.png'],
      refWire: 'agnes_keyframes',
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.extra_body).toEqual({
      image: ['https://cdn/a.png', 'https://cdn/b.png'],
      mode: 'keyframes',
    })
    expect(body).not.toHaveProperty('image')
  })

  it('returns url from metadata when top-level url is absent', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-meta' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'completed',
          metadata: { url: 'https://example.com/meta-video.mp4' },
        }),
      })

    const provider = new AgnesVideoProvider('test-key', 'https://apihub.agnes-ai.com/v1', 'https://apihub.agnes-ai.com', 'agnes-video-v2.0', 0)
    const { url } = await provider.generate('animate')
    expect(url).toBe('https://example.com/meta-video.mp4')
  })

  it('passes seed and negative_prompt in create body', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ video_id: 'vid-seed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', url: 'https://example.com/seed.mp4' }),
      })

    const provider = new AgnesVideoProvider('test-key', 'https://apihub.agnes-ai.com/v1', 'https://apihub.agnes-ai.com', 'agnes-video-v2.0', 0)
    await provider.generate('animate', {
      seed: 42,
      negativePrompt: 'watermark, blur',
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.seed).toBe(42)
    expect(body.negative_prompt).toBe('watermark, blur')
  })
})
