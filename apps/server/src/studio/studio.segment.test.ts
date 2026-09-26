import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createSegmentProvider } from '@lnkpi/agent'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProviderResolverService } from '../provider/provider-resolver.service'
import { MediaProbeService } from '../media/media-probe.service'
import { UploadService } from '../upload/upload.service'
import { inlineUpstreamReferenceImages } from '../media/upstream-ref-inline'
import { readImageBuffer } from '../media/composite-unmasked'
import {
  computeMaskBBox,
  cropImageToDataUrl,
  normalizeMaskPng,
  parseElementName,
} from './element-recognize.util'
import { sharpMeta } from './studio.segment.mocks'
import {
  StudioService,
  allowSegmentRate,
  resetSegmentRateLimitForTests,
} from './studio.service'

const segment = vi.fn()

vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createSegmentProvider: vi.fn(() => ({ segment })),
  }
})
vi.mock('../media/upstream-ref-inline', () => ({
  inlineUpstreamReferenceImages: vi.fn(async (urls: string[]) => urls),
}))
vi.mock('./element-recognize.util', () => ({
  computeMaskBBox: vi.fn(),
  cropImageToDataUrl: vi.fn(),
  normalizeMaskPng: vi.fn(),
  parseElementName: vi.fn(),
}))
vi.mock('sharp', () => ({ default: () => ({ metadata: sharpMeta }) }))
vi.mock('../media/composite-unmasked', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media/composite-unmasked')>()
  return { ...actual, readImageBuffer: vi.fn() }
})

describe('allowSegmentRate', () => {
  beforeEach(() => {
    resetSegmentRateLimitForTests()
  })

  it('allows up to 20 requests per 60s window', () => {
    const base = 1_000_000
    for (let i = 0; i < 20; i++) {
      expect(allowSegmentRate('u1', base + i)).toBe(true)
    }
    expect(allowSegmentRate('u1', base + 20)).toBe(false)
  })

  it('tracks limits independently per user', () => {
    const base = 1_000_000
    for (let i = 0; i < 20; i++) {
      allowSegmentRate('user-a', base + i)
    }
    expect(allowSegmentRate('user-a', base + 20)).toBe(false)
    expect(allowSegmentRate('user-b', base)).toBe(true)
  })

  it('expires timestamps outside window', () => {
    const now = 1_000_000
    for (let i = 0; i < 20; i++) {
      allowSegmentRate('u1', now + i)
    }
    expect(allowSegmentRate('u1', now + 20)).toBe(false)
    expect(allowSegmentRate('u1', now + 61_000)).toBe(true)
  })
})

describe('StudioService.segmentImage', () => {
  let svc: StudioService
  let pointsConsume: ReturnType<typeof vi.fn>
  const savedFalKey = process.env.FAL_KEY

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSegmentRateLimitForTests()
    process.env.FAL_KEY = 'fal-test-key'
    pointsConsume = vi.fn(async () => {})
    segment.mockResolvedValue({ maskUrl: 'https://m' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PointsService,
          useValue: {
            consume: pointsConsume,
            refund: vi.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ProviderResolverService,
          useValue: {},
        },
        {
          provide: MediaProbeService,
          useValue: {},
        },
        {
          provide: UploadService,
          useValue: {},
        },
      ],
    }).compile()

    svc = moduleRef.get(StudioService)
  })

  afterEach(() => {
    if (savedFalKey === undefined) delete process.env.FAL_KEY
    else process.env.FAL_KEY = savedFalKey
  })

  it('segmentImage returns maskUrl without charging points', async () => {
    const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 })

    expect(out).toEqual({ maskUrl: 'https://m' })
    expect(pointsConsume).not.toHaveBeenCalled()
    expect(createSegmentProvider).toHaveBeenCalledWith({ apiKey: 'fal-test-key' })
    expect(inlineUpstreamReferenceImages).toHaveBeenCalledWith(['https://a.png'])
    expect(segment).toHaveBeenCalledWith({
      imageUrl: 'https://a.png',
      x: 1,
      y: 2,
      label: 1,
    })
  })

  it('throws ServiceUnavailable when FAL_KEY missing', async () => {
    delete process.env.FAL_KEY

    await expect(
      svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(segment).not.toHaveBeenCalled()
  })

  it('rejects empty imageUrl', async () => {
    await expect(svc.segmentImage('u1', { imageUrl: '', x: 1, y: 2 })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects negative coordinates', async () => {
    await expect(
      svc.segmentImage('u1', { imageUrl: 'https://a.png', x: -1, y: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects non-finite coordinates', async () => {
    await expect(
      svc.segmentImage('u1', { imageUrl: 'https://a.png', x: Number.NaN, y: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws 429 when rate limit exceeded', async () => {
    for (let i = 0; i < 20; i++) {
      await svc.segmentImage('u-rate', { imageUrl: 'https://a.png', x: 1, y: 2 })
    }

    await expect(
      svc.segmentImage('u-rate', { imageUrl: 'https://a.png', x: 1, y: 2 }),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: '点选过于频繁，请稍后再试',
    })
  })

  it('passes custom label to provider', async () => {
    await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2, label: 0 })

    expect(segment).toHaveBeenCalledWith(
      expect.objectContaining({ label: 0 }),
    )
  })

  it('maps provider failure to BadGatewayException', async () => {
    segment.mockRejectedValueOnce(new Error('Segment API 403: TOP_UP'))

    await expect(
      svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 }),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})

describe('StudioService.segmentImage (internal MobileSAM)', () => {
  let svc: StudioService
  const savedSegmentUrl = process.env.LNKPI_SEGMENT_SERVICE_URL
  const saveUserFile = vi.fn()
  const readImageBufferMock = readImageBuffer as unknown as ReturnType<typeof vi.fn>

  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
  const fakeFetch = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSegmentRateLimitForTests()
    process.env.FAL_KEY = 'fal-test-key'
    process.env.LNKPI_SEGMENT_SERVICE_URL = 'http://lnkpi-segment:8000'
    saveUserFile.mockResolvedValue({ url: 'http://host/api/uploads/u1/segment.png' })
    readImageBufferMock.mockResolvedValue(PNG_BYTES)
    vi.stubGlobal('fetch', fakeFetch)
    fakeFetch.mockImplementation(async (_url: string, init?: { body?: unknown }) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      if (body.includes('"image"')) {
        return { ok: true, arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength) }
      }
      throw new Error('unexpected fetch')
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        { provide: PointsService, useValue: { consume: vi.fn(), refund: vi.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: ProviderResolverService, useValue: {} },
        { provide: MediaProbeService, useValue: {} },
        { provide: UploadService, useValue: { saveUserFile } },
      ],
    }).compile()
    svc = moduleRef.get(StudioService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (savedSegmentUrl === undefined) delete process.env.LNKPI_SEGMENT_SERVICE_URL
    else process.env.LNKPI_SEGMENT_SERVICE_URL = savedSegmentUrl
  })

  it('routes to internal service and saves mask via saveUserFile', async () => {
    const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 10, y: 20 })

    expect(out).toEqual({ maskUrl: 'http://host/api/uploads/u1/segment.png' })
    expect(fakeFetch).toHaveBeenCalledWith(
      'http://lnkpi-segment:8000/segment',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.points).toEqual([{ x: 10, y: 20, label: 1 }])
    expect(body.image).toBeTruthy()
    expect(saveUserFile).toHaveBeenCalledWith('u1', PNG_BYTES, 'segment.png', 'image/png')
    expect(segment).not.toHaveBeenCalled()
  })

  it('passes box prompt through to internal service', async () => {
    const out = await svc.segmentImage('u1', {
      imageUrl: 'https://a.png',
      box: { x1: 50, y1: 30, x2: 10, y2: 60 },
    })

    expect(out).toEqual({ maskUrl: 'http://host/api/uploads/u1/segment.png' })
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    // 框坐标归一化（min/max 交换）
    expect(body.box).toEqual([10, 30, 50, 60])
    expect(segment).not.toHaveBeenCalled()
  })

  it('passes multi points with negative label and dilate to internal service', async () => {
    const out = await svc.segmentImage('u1', {
      imageUrl: 'https://a.png',
      points: [
        { x: 10, y: 10, label: 1 },
        { x: 20, y: 20, label: 0 },
      ],
      dilate: 999,
    })

    expect(out).toEqual({ maskUrl: 'http://host/api/uploads/u1/segment.png' })
    const body = JSON.parse(fakeFetch.mock.calls[0][1].body)
    expect(body.points).toEqual([
      { x: 10, y: 10, label: 1 },
      { x: 20, y: 20, label: 0 },
    ])
    // dilate 限幅 ±64
    expect(body.dilate).toBe(64)
  })

  it('rejects when no valid prompt provided', async () => {
    await expect(
      svc.segmentImage('u1', { imageUrl: 'https://a.png', points: [] }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('fal fallback uses box center when only box prompt given', async () => {
    fakeFetch.mockRejectedValue(new Error('internal down'))
    segment.mockResolvedValue({ maskUrl: 'https://fal-m' })

    const out = await svc.segmentImage('u1', {
      imageUrl: 'https://a.png',
      box: { x1: 0, y1: 0, x2: 100, y2: 60 },
    })

    expect(out).toEqual({ maskUrl: 'https://fal-m' })
    expect(segment).toHaveBeenCalledWith(
      expect.objectContaining({ x: 50, y: 30, label: 1 }),
    )
  })

  it('fal fallback skips negative points and uses first positive point', async () => {
    fakeFetch.mockRejectedValue(new Error('internal down'))
    segment.mockResolvedValue({ maskUrl: 'https://fal-m' })

    await svc.segmentImage('u1', {
      imageUrl: 'https://a.png',
      points: [
        { x: 5, y: 5, label: 0 },
        { x: 30, y: 40, label: 1 },
      ],
    })

    expect(segment).toHaveBeenCalledWith(
      expect.objectContaining({ x: 30, y: 40, label: 1 }),
    )
  })

  it('falls back to fal when internal service errors', async () => {
    fakeFetch.mockRejectedValue(new Error('connect timeout'))
    segment.mockResolvedValue({ maskUrl: 'https://fal-m' })

    const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 })

    expect(out).toEqual({ maskUrl: 'https://fal-m' })
    expect(segment).toHaveBeenCalled()
  })

  it('falls back to fal when internal returns non-PNG', async () => {
    fakeFetch.mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }))
    segment.mockResolvedValue({ maskUrl: 'https://fal-m' })

    const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 })

    expect(out).toEqual({ maskUrl: 'https://fal-m' })
    expect(segment).toHaveBeenCalled()
  })

  it('works without FAL_KEY when internal succeeds', async () => {
    delete process.env.FAL_KEY

    const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 })

    expect(out).toEqual({ maskUrl: 'http://host/api/uploads/u1/segment.png' })
    expect(segment).not.toHaveBeenCalled()
  })
})

describe('StudioService.elementRecognize (naming degrade)', () => {
  const savedEnv = {
    seg: process.env.LNKPI_SEGMENT_SERVICE_URL,
    naming: process.env.LNKPI_VISION_NAMING_MODEL,
    fal: process.env.FAL_KEY,
  }
  const saveUserFile = vi.fn()
  const resolveForGeneration = vi.fn()
  const readImageBufferMock = readImageBuffer as unknown as ReturnType<typeof vi.fn>
  const bbox = { x: 10, y: 10, width: 40, height: 40 }
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
  const fakeFetch = vi.fn()
  let svc: StudioService

  const visionResolved = (modelName: string) => ({
    channelId: 'platform',
    modelName,
    apiFormat: 'openai' as const,
    credentials: { apiKey: 'k', baseUrl: 'https://x/v1' },
    source: 'platform' as const,
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSegmentRateLimitForTests()
    delete process.env.FAL_KEY
    delete process.env.LNKPI_VISION_NAMING_MODEL
    process.env.LNKPI_SEGMENT_SERVICE_URL = 'http://lnkpi-segment:8000'
    saveUserFile.mockResolvedValue({ url: 'http://host/api/uploads/u1/element-mask.png' })
    readImageBufferMock.mockResolvedValue(PNG_BYTES)
    sharpMeta.mockResolvedValue({ width: 200, height: 160 })
    vi.mocked(computeMaskBBox).mockResolvedValue(bbox)
    vi.mocked(normalizeMaskPng).mockResolvedValue(PNG_BYTES)
    vi.mocked(cropImageToDataUrl).mockResolvedValue('data:image/png;base64,xxx')
    vi.mocked(parseElementName).mockImplementation((t: string) => {
      try {
        return (JSON.parse(t) as { name?: string }).name ?? null
      } catch {
        return null
      }
    })
    vi.stubGlobal('fetch', fakeFetch)
    fakeFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        { provide: PointsService, useValue: { consume: vi.fn(), refund: vi.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: ProviderResolverService, useValue: { resolveForGeneration } },
        { provide: MediaProbeService, useValue: {} },
        { provide: UploadService, useValue: { saveUserFile } },
      ],
    }).compile()
    svc = moduleRef.get(StudioService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [k, v] of [
      ['LNKPI_SEGMENT_SERVICE_URL', savedEnv.seg],
      ['LNKPI_VISION_NAMING_MODEL', savedEnv.naming],
      ['FAL_KEY', savedEnv.fal],
    ] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('returns recognized name when naming succeeds', async () => {
    resolveForGeneration.mockResolvedValue(visionResolved('agnes-2.0-flash'))
    vi.spyOn(svc, 'runVisionQaInternal').mockResolvedValue({
      text: '{"name":"锤子"}',
      visionUsed: true,
    })

    const out = await svc.elementRecognize('u1', { imageUrl: 'https://a.png', x: 30, y: 30 })

    expect(out.name).toBe('锤子')
    expect(out.maskUrl).toBe('http://host/api/uploads/u1/element-mask.png')
    expect(out.bbox).toEqual(bbox)
  })

  it('degrades to 选区 when naming call fails (mask still returned)', async () => {
    resolveForGeneration.mockResolvedValue(visionResolved('agnes-2.0-flash'))
    vi.spyOn(svc, 'runVisionQaInternal').mockRejectedValue(new Error('vision down'))

    const out = await svc.elementRecognize('u1', { imageUrl: 'https://a.png', x: 30, y: 30 })

    expect(out.name).toBe('选区')
    expect(out.maskUrl).toBe('http://host/api/uploads/u1/element-mask.png')
  })

  it('degrades to 选区 when no vision-capable model (no 400)', async () => {
    resolveForGeneration.mockResolvedValue(visionResolved('text-embedding-3'))

    const out = await svc.elementRecognize('u1', { imageUrl: 'https://a.png', x: 30, y: 30 })

    expect(out.name).toBe('选区')
    expect(out.maskUrl).toBe('http://host/api/uploads/u1/element-mask.png')
  })

  it('uses LNKPI_VISION_NAMING_MODEL as naming fallback candidate', async () => {
    process.env.LNKPI_VISION_NAMING_MODEL = 'gemini-2.0-flash'
    resolveForGeneration
      .mockResolvedValueOnce(visionResolved('text-embedding-3'))
      .mockResolvedValueOnce(visionResolved('gemini-2.0-flash'))
    vi.spyOn(svc, 'runVisionQaInternal').mockResolvedValue({
      text: '{"name":"盾牌"}',
      visionUsed: true,
    })

    const out = await svc.elementRecognize('u1', { imageUrl: 'https://a.png', x: 30, y: 30 })

    expect(out.name).toBe('盾牌')
    expect(resolveForGeneration).toHaveBeenCalledWith('u1', 'gemini-2.0-flash', 'text')
  })
})
