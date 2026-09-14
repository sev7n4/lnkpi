import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FalH3MaxVideoProvider } from './fal-h3-max-video-provider'
import { MiniMaxH3VideoProvider } from './minimax-h3-video-provider'
import {
  AgnesVideoProvider,
  ApimartVideoProvider,
  createVideoProvider,
  isFalBaseUrl,
  isFalVideoModel,
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

describe('isFalVideoModel / isFalBaseUrl', () => {
  it('detects h3-max model keys and gateways case-insensitively', () => {
    expect(isFalVideoModel('h3-max-turbo')).toBe(true)
    expect(isFalVideoModel('h3-max')).toBe(true)
    expect(isFalVideoModel('minimax/h3-max-turbo')).toBe(true)
    expect(isFalVideoModel('MINIMAX/H3-MAX')).toBe(true)
    expect(isFalVideoModel('agnes-video-v2.0')).toBe(false)
    expect(isFalVideoModel(undefined)).toBe(false)
  })

  it('detects fal.ai and fal.run hosts including queue.fal.run', () => {
    expect(isFalBaseUrl('https://fal.run')).toBe(true)
    expect(isFalBaseUrl('https://queue.fal.run')).toBe(true)
    expect(isFalBaseUrl('https://fal.ai')).toBe(true)
    expect(isFalBaseUrl('https://www.fal.ai/models')).toBe(true)
    expect(isFalBaseUrl('https://apihub.agnes-ai.com/v1')).toBe(false)
    expect(isFalBaseUrl('https://fal.run.attacker.example/v1')).toBe(false)
    expect(isFalBaseUrl(undefined)).toBe(false)
  })
})

describe('createVideoProvider fal routing', () => {
  const env = { ...process.env }

  beforeEach(() => {
    process.env = { ...env }
    process.env.FAL_KEY = 'env-fal-key-must-not-be-read'
  })

  afterEach(() => {
    process.env = env
  })

  it('returns FalH3MaxVideoProvider for fal model even when baseUrl looks like Agnes', () => {
    const p = createVideoProvider({
      apiKey: 'opts-fal-key',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'h3-max-turbo',
    })
    expect(p).toBeInstanceOf(FalH3MaxVideoProvider)
  })

  it('returns FalH3MaxVideoProvider for fal baseUrl', () => {
    const p = createVideoProvider({
      apiKey: 'opts-fal-key',
      baseUrl: 'https://fal.run',
      model: 'agnes-video-v2.0',
    })
    expect(p).toBeInstanceOf(FalH3MaxVideoProvider)
  })

  it('still routes Agnes when apiKey + agnes host + non-fal model', () => {
    const p = createVideoProvider({
      apiKey: 'opts-key',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'agnes-video-v2.0',
    })
    expect(p).toBeInstanceOf(AgnesVideoProvider)
  })

  it('does not read process.env.FAL_KEY for routing', () => {
    const p = createVideoProvider({
      apiKey: 'opts-fal-key',
      baseUrl: 'https://queue.fal.run',
      model: 'minimax/h3-max',
    })
    expect(p).toBeInstanceOf(FalH3MaxVideoProvider)
    expect(p).not.toBeInstanceOf(AgnesVideoProvider)
  })

  it('throws 视频加速通道未配置 for fal baseUrl without apiKey even when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'env-openai-must-not-be-used'
    process.env.OPENAI_BASE_URL = 'https://apihub.agnes-ai.com/v1'
    expect(() =>
      createVideoProvider({ model: 'h3-max-turbo', baseUrl: 'https://fal.run' }),
    ).toThrow('视频加速通道未配置')
  })

  it('throws 视频加速通道未配置 for h3-max model without apiKey or baseUrl', () => {
    process.env.OPENAI_API_KEY = 'env-openai-must-not-be-used'
    process.env.OPENAI_BASE_URL = 'https://apihub.agnes-ai.com/v1'
    expect(() => createVideoProvider({ model: 'h3-max' })).toThrow('视频加速通道未配置')
  })
})

describe('createVideoProvider MiniMax routing', () => {
  const env = { ...process.env }

  beforeEach(() => {
    process.env = { ...env }
  })

  afterEach(() => {
    process.env = env
  })

  it('createVideoProvider routes MiniMax-H3 with Bearer provider before Agnes', () => {
    const p = createVideoProvider({
      apiKey: 'mm-key',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      model: 'minimax-h3',
    })
    expect(p).toBeInstanceOf(MiniMaxH3VideoProvider)
    expect(p).not.toBeInstanceOf(AgnesVideoProvider)
    expect(p).not.toBeInstanceOf(FalH3MaxVideoProvider)
  })

  it('routes MiniMax-H3 gateway id and official baseUrl to MiniMax provider', () => {
    expect(
      createVideoProvider({
        apiKey: 'mm-key',
        baseUrl: 'https://api.minimax.io',
        model: 'MiniMax-H3',
      }),
    ).toBeInstanceOf(MiniMaxH3VideoProvider)
    expect(
      createVideoProvider({
        apiKey: 'mm-key',
        baseUrl: 'https://api.minimax.io',
        model: 'agnes-video-v2.0',
      }),
    ).toBeInstanceOf(MiniMaxH3VideoProvider)
  })

  it('keeps fal first for h3-max-turbo even with MiniMax baseUrl', () => {
    const p = createVideoProvider({
      apiKey: 'fal-key',
      baseUrl: 'https://api.minimax.io',
      model: 'h3-max-turbo',
    })
    expect(p).toBeInstanceOf(FalH3MaxVideoProvider)
  })

  it('refuses MiniMax model without apiKey even if OPENAI_API_KEY set', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    process.env.OPENAI_BASE_URL = 'https://apihub.agnes-ai.com/v1'
    expect(() =>
      createVideoProvider({ model: 'minimax-h3', baseUrl: 'https://api.minimax.io' }),
    ).toThrow('未配置 MiniMax API Key')
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
